# DeepSWE v1.1 (Pier / Docker) — scores **and** per-task tokens

Droplet runner for DeepSWE against DigitalOcean Serverless Inference using Pier + `mini-swe-agent`.

After each model job, `extract_deepswe_pier_usage.py` walks Pier trial trees and writes optimizer evidence schema **0.1** `token_usage` from `agent_result.n_input_tokens` / `n_output_tokens` / `n_cache_tokens` (same path as prior DeepSWE Pier evidence ingest).

This is **not** the TypeScript portal / Modal harness under `src/benchmarks/deep-swe/`.

## Layout

```text
scripts/deepswe-pier/
├── README.md
├── .env.example
├── run_deepswe_pier.sh
├── extract_deepswe_pier_usage.py
└── extract_deepswe_pier_usage_test.py
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
cd scripts/deepswe-pier
cp .env.example .env
# OPENROUTER_API_KEY=<DO inference token>
# OPENROUTER_BASE_URL=https://inference.do-ai.run/v1
```

## Run

```bash
cd scripts/deepswe-pier
tmux new -s deepswe-pier
bash run_deepswe_pier.sh
```

Clones `datacurve-ai/deep-swe` at pin `0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea` (v1.1 / 113 tasks — same as prior optimizer Pier waves).

### Outputs (keep all of these)

```text
outputs/deepswe-pier-<stamp>/<model>/
├── ... Pier trial trees (tasks/*/result.json)   # DO NOT DELETE
└── evidence/
    ├── per_task_usage.jsonl   # schema token_usage per task
    ├── per_task_usage.csv
    └── usage_summary.json
```

## Re-extract only

```bash
python3 extract_deepswe_pier_usage.py outputs/deepswe-pier-<stamp>/<model>
```

## Tests

```bash
cd scripts/deepswe-pier
python3 extract_deepswe_pier_usage_test.py
```

## Knobs

| Env                  | Default          | Meaning            |
| -------------------- | ---------------- | ------------------ |
| `AGENT`              | `mini-swe-agent` | Pier agent         |
| `N_CONCURRENT`       | `1`              | Pier `-n`          |
| `MAX_JOBS`           | `2`              | models in parallel |
| `MAX_RETRIES`        | `2`              | Pier `-r`          |
| `OVERRIDE_CPUS`      | `4`              | container CPUs     |
| `OVERRIDE_MEMORY_MB` | `8192`           | container memory   |
| `DEEP_SWE_DIR`       | `/root/deep-swe` | task clone         |

```bash
MAX_JOBS=2 N_CONCURRENT=1 bash run_deepswe_pier.sh
```

Edit `MODELS=(...)` in `run_deepswe_pier.sh` for a smoke subset.
