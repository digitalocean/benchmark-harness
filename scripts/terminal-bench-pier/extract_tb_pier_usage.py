#!/usr/bin/env python3
"""Extract per-task token usage from Pier Terminal-Bench job outputs.

Pier trial `result.json` files carry mini-swe-agent totals under `agent_result`:
  n_input_tokens, n_output_tokens, n_cache_tokens

This emits optimizer evidence schema 0.1 `token_usage` rows (same shape as
portal sample_* / DeepSWE Pier ingest). Null is never invented: trials without
agent_result usage are skipped with a warning.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any


TOKEN_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
)


def _int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float) and value.is_integer() and value >= 0:
        return int(value)
    return None


def token_usage_from_agent_result(agent_result: dict[str, Any]) -> dict[str, Any] | None:
    """Map Pier agent_result → schema token_usage.

    Pier's n_input_tokens is OpenAI-style (includes cache reads). Cache creation
    is not reported separately, so cache_creation_input_tokens is 0 when input
    and cache read are known.
    """
    inp = _int_or_none(agent_result.get("n_input_tokens"))
    out = _int_or_none(agent_result.get("n_output_tokens"))
    cache_read = _int_or_none(agent_result.get("n_cache_tokens"))
    if inp is None and out is None and cache_read is None:
        return None
    if cache_read is None:
        cache_read = 0
    if inp is not None and cache_read > inp:
        raise ValueError(
            f"n_cache_tokens ({cache_read}) exceeds n_input_tokens ({inp})"
        )
    return {
        "input_tokens": inp,
        "output_tokens": out,
        "cache_read_input_tokens": cache_read,
        "cache_creation_input_tokens": 0 if inp is not None else None,
        "cache_creation": {
            "ephemeral_5m_input_tokens": 0 if inp is not None else None,
            "ephemeral_1h_input_tokens": 0 if inp is not None else None,
        },
    }


def task_id_from_path(path: Path, job_root: Path) -> str | None:
    """Infer task id from Pier layouts: .../tasks/<id>/result.json or trial dirs."""
    parts = path.relative_to(job_root).parts
    if "tasks" in parts:
        i = parts.index("tasks")
        if i + 1 < len(parts):
            return parts[i + 1]
    # trial folder names look like adaptive-rejection-sampler__abc123
    parent = path.parent.name
    if "__" in parent:
        return parent.split("__", 1)[0]
    if parent not in {".", "agent", "verifier", "artifacts"}:
        return parent
    return None


def is_trial_result(data: dict[str, Any]) -> bool:
    if "agent_result" in data:
        return True
    rewards = (data.get("verifier_result") or {}).get("rewards")
    return isinstance(rewards, dict)


def is_job_result(data: dict[str, Any]) -> bool:
    return "n_total_trials" in data or (
        isinstance(data.get("stats"), dict) and "evals" in data["stats"]
    )


def iter_trial_results(job_root: Path) -> list[tuple[Path, dict[str, Any]]]:
    found: list[tuple[Path, dict[str, Any]]] = []
    for path in sorted(job_root.rglob("result.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"WARN: skip {path}: {exc}", file=sys.stderr)
            continue
        if not isinstance(data, dict) or is_job_result(data):
            continue
        if not is_trial_result(data):
            continue
        found.append((path, data))
    return found


def extract_job(job_root: Path) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    rows: list[dict[str, Any]] = []
    job_usage: dict[str, Any] | None = None

    job_result_path = job_root / "result.json"
    if job_result_path.is_file():
        try:
            job = json.loads(job_result_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            job = None
        if isinstance(job, dict):
            # Job-level totals sometimes live under stats.evals.*.agent_info / nested keys.
            blob = json.dumps(job)
            if "n_input_tokens" in blob:
                def walk(obj: Any) -> dict[str, Any] | None:
                    if isinstance(obj, dict):
                        if "n_input_tokens" in obj and "n_output_tokens" in obj:
                            return token_usage_from_agent_result(obj)
                        for value in obj.values():
                            hit = walk(value)
                            if hit is not None:
                                return hit
                    elif isinstance(obj, list):
                        for value in obj:
                            hit = walk(value)
                            if hit is not None:
                                return hit
                    return None

                job_usage = walk(job)

    seen: set[str] = set()
    for path, data in iter_trial_results(job_root):
        task_id = task_id_from_path(path, job_root)
        if task_id is None:
            print(f"WARN: cannot infer task id for {path}", file=sys.stderr)
            continue
        if task_id in seen:
            # Prefer the first completed trial; Pier retries share the task stem.
            continue
        agent_result = data.get("agent_result") or {}
        if not isinstance(agent_result, dict):
            agent_result = {}
        try:
            usage = token_usage_from_agent_result(agent_result)
        except ValueError as exc:
            print(f"WARN: {task_id}: {exc}", file=sys.stderr)
            continue
        if usage is None or all(usage.get(k) is None for k in TOKEN_FIELDS):
            print(f"WARN: {task_id}: no agent_result token fields in {path}", file=sys.stderr)
            continue
        rewards = (data.get("verifier_result") or {}).get("rewards") or {}
        reward = rewards.get("reward")
        status = "completed"
        if data.get("exception_info") is not None and reward is None:
            status = "infra_error"
        rows.append(
            {
                "task_id": task_id,
                "trial_id": data.get("id"),
                "status": status,
                "reward": reward,
                "token_usage": usage,
                "source_result": str(path.relative_to(job_root)),
            }
        )
        seen.add(task_id)
    return rows, job_usage


def write_outputs(
    job_root: Path,
    rows: list[dict[str, Any]],
    job_usage: dict[str, Any] | None,
) -> Path:
    out_dir = job_root / "evidence"
    out_dir.mkdir(parents=True, exist_ok=True)
    usage_path = out_dir / "per_task_usage.jsonl"
    with usage_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    csv_path = out_dir / "per_task_usage.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "task_id",
                "status",
                "reward",
                "input_tokens",
                "output_tokens",
                "cache_read_input_tokens",
                "cache_creation_input_tokens",
            ],
        )
        writer.writeheader()
        for row in rows:
            usage = row["token_usage"]
            writer.writerow(
                {
                    "task_id": row["task_id"],
                    "status": row["status"],
                    "reward": row["reward"],
                    "input_tokens": usage.get("input_tokens"),
                    "output_tokens": usage.get("output_tokens"),
                    "cache_read_input_tokens": usage.get("cache_read_input_tokens"),
                    "cache_creation_input_tokens": usage.get(
                        "cache_creation_input_tokens"
                    ),
                }
            )

    summary = {
        "job_root": str(job_root),
        "n_tasks_with_usage": len(rows),
        "sums": {
            key: sum(r["token_usage"][key] for r in rows if r["token_usage"].get(key) is not None)
            if any(r["token_usage"].get(key) is not None for r in rows)
            else None
            for key in TOKEN_FIELDS
        },
        "job_level_token_usage": job_usage,
    }
    (out_dir / "usage_summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    return usage_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "job_roots",
        nargs="+",
        type=Path,
        help="Pier -o output directories (one model job each)",
    )
    args = parser.parse_args()
    exit_code = 0
    for job_root in args.job_roots:
        job_root = job_root.resolve()
        if not job_root.is_dir():
            print(f"ERROR: not a directory: {job_root}", file=sys.stderr)
            exit_code = 1
            continue
        rows, job_usage = extract_job(job_root)
        path = write_outputs(job_root, rows, job_usage)
        print(f"{job_root}: wrote {len(rows)} task usage rows -> {path}")
        if not rows:
            print(
                f"ERROR: no per-task usage under {job_root}; "
                "keep Pier trial trees (do not delete tasks/*/result.json)",
                file=sys.stderr,
            )
            exit_code = 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
