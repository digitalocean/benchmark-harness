#!/usr/bin/env python3
"""Network-free checks for Pier TB usage extraction."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from extract_tb_pier_usage import extract_job, token_usage_from_agent_result, write_outputs


class ExtractTbPierUsageTest(unittest.TestCase):
    def test_maps_agent_result_to_schema(self) -> None:
        usage = token_usage_from_agent_result(
            {
                "n_input_tokens": 100,
                "n_output_tokens": 20,
                "n_cache_tokens": 40,
            }
        )
        assert usage is not None
        self.assertEqual(usage["input_tokens"], 100)
        self.assertEqual(usage["output_tokens"], 20)
        self.assertEqual(usage["cache_read_input_tokens"], 40)
        self.assertEqual(usage["cache_creation_input_tokens"], 0)

    def test_extracts_tasks_layout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            trial = root / "tasks" / "hello-world" / "result.json"
            trial.parent.mkdir(parents=True)
            trial.write_text(
                json.dumps(
                    {
                        "id": "trial-1",
                        "agent_result": {
                            "n_input_tokens": 50,
                            "n_output_tokens": 10,
                            "n_cache_tokens": 5,
                        },
                        "verifier_result": {"rewards": {"reward": 1.0}},
                    }
                ),
                encoding="utf-8",
            )
            (root / "result.json").write_text(
                json.dumps({"n_total_trials": 1, "stats": {"evals": {}}}),
                encoding="utf-8",
            )
            rows, _job = extract_job(root)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["task_id"], "hello-world")
            self.assertEqual(rows[0]["token_usage"]["input_tokens"], 50)
            path = write_outputs(root, rows, None)
            self.assertTrue(path.is_file())
            line = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
            self.assertEqual(line["token_usage"]["cache_read_input_tokens"], 5)


if __name__ == "__main__":
    unittest.main()
