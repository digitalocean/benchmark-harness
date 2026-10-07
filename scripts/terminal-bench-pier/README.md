# Terminal-Bench 2.1 (Pier / Docker) — scores **and** per-task tokens

Droplet runner for Terminal-Bench 2.1 against DigitalOcean Serverless Inference
using Pier + `mini-swe-agent`.

After each model job, `extract_tb_pier_usage.py` walks Pier trial trees and writes
optimizer evidence schema **0.1** `token_usage` rows from
`agent_result.n_input_tokens` / `n_output_tokens` / `n_cache_tokens`
(same fields DeepSWE Pier ingest uses).

This is **not** the TypeScript portal / Modal harness under
`src/benchmarks/terminal-bench/`.

## Layout

```text
scripts/terminal-bench-pier/
├── README.md
├── .env.example
├── run_tb_pier.sh              # run Pier jobs + extract usage
├── extract_tb_pier_usage.py    # per-task token_usage → evidence/
└── extract_tb_pier_usage_test.py
```

## One-time setup (Ubuntu droplet)

```bash
sudo apt-get update && sudo apt-get install -y docker.io git python3 python3-venv
sudo systemctl enable --now docker

sudo python3 -m venv /root/pier-venv
sudo /root/pier-venv/bin/pip install -U pip pier
/root/pier-venv/bin/pier --help
```

## Configure

```bash
cd scripts/terminal-bench-pier
cp .env.example .env
# OPENROUTER_API_KEY=<DO inference token>
# OPENROUTER_BASE_URL=https://inference.do-ai.run/v1
```

## Run

```bash
cd scripts/terminal-bench-pier
tmux new -s tb-pier
bash run_tb_pier.sh
```

### Outputs (keep all of these)

```text
outputs/tb-pier-<stamp>/<model>/
├── ... Pier trial trees (tasks/*/result.json)   # DO NOT DELETE
└── evidence/
    ├── per_task_usage.jsonl   # schema token_usage per task  ← optimizer
    ├── per_task_usage.csv
    └── usage_summary.json
```

Each `per_task_usage.jsonl` line looks like:

```json
{
  "task_id": "adaptive-rejection-sampler",
  "trial_id": "...",
  "status": "completed",
  "reward": 1.0,
  "token_usage": {
    "input_tokens": 12345,
    "output_tokens": 678,
    "cache_read_input_tokens": 9000,
    "cache_creation_input_tokens": 0,
    "cache_creation": {
      "ephemeral_5m_input_tokens": 0,
      "ephemeral_1h_input_tokens": 0
    }
  }
}
```

`input_tokens` is Pier’s total input (**includes** cache reads). That matches the
evidence normalizer’s OpenAI-compatible semantics.

## Re-extract only

If Pier already finished but usage files are missing:

```bash
python3 extract_tb_pier_usage.py outputs/tb-pier-<stamp>/<model>
# or any nested job dir that contains trial result.json files
```

## Tests

```bash
cd scripts/terminal-bench-pier
python3 extract_tb_pier_usage_test.py
```

## Knobs

| Env | Default | Meaning |
|-----|---------|---------|
| `AGENT` | `mini-swe-agent` | Pier agent |
| `N_CONCURRENT` | `1` | Pier `-n` |
| `MAX_JOBS` | `1` | models in parallel |
| `MAX_RETRIES` | `2` | Pier `-r` |
| `OVERRIDE_CPUS` | `2` | container CPUs |
| `OVERRIDE_MEMORY_MB` | `4096` | container memory |
| `TB_DIR` | `/root/terminal-bench-2-1` | task clone |

```bash
MAX_JOBS=2 N_CONCURRENT=2 bash run_tb_pier.sh
```

Edit `MODELS=(...)` in `run_tb_pier.sh` for a smoke subset.

## Notes

- Needs Docker + disk for task images and **full trial trees**.
- Without trial `result.json` / `agent_result`, scores may exist but tokens will not.
- Ship back `outputs/tb-pier-*/**/evidence/per_task_usage.jsonl` plus Pier `result.json` / CSV for ingest.
