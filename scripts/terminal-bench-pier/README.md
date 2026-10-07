# Terminal-Bench 2.1 (Pier / Docker)

Droplet runner for Terminal-Bench 2.1 against DigitalOcean Serverless Inference
using Pier + `mini-swe-agent`. This is the Pier path used for optimizer evidence
scores (not the TypeScript portal / Modal harness under `src/benchmarks/terminal-bench/`).

## Layout

```text
scripts/terminal-bench-pier/
├── README.md
├── .env.example          # copy → .env and fill token (do not commit .env)
└── run_tb_pier.sh
```

## One-time setup (Ubuntu droplet recommended)

```bash
# Docker + git
sudo apt-get update && sudo apt-get install -y docker.io git python3-venv
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # then re-login if not root

# Pier (script expects /root/pier-venv or pier on PATH)
sudo python3 -m venv /root/pier-venv
sudo /root/pier-venv/bin/pip install -U pip pier
/root/pier-venv/bin/pier --help
```

If you are not root:

```bash
export PIER=/path/to/venv/bin/pier
export TB_DIR=$HOME/terminal-bench-2-1
export PATH="$(dirname "$PIER"):$PATH"
```

## Configure inference

```bash
cd scripts/terminal-bench-pier
cp .env.example .env
# edit .env:
#   OPENROUTER_API_KEY=<DO Model Access / inference token>
#   OPENROUTER_BASE_URL=https://inference.do-ai.run/v1
```

## Run

```bash
cd scripts/terminal-bench-pier
tmux new -s tb-pier
bash run_tb_pier.sh
# detach: Ctrl-b d
```

The script will:

1. Clone `harbor-framework/terminal-bench-2-1` at pin `c5ee500c185224c97cd6caff7866a990a0057f41`
2. Run Pier with `-e docker` for each model in `MODELS`
3. Write logs → `logs/tb-pier-<stamp>/` and outputs → `outputs/tb-pier-<stamp>/`

## Knobs

| Env | Default | Meaning |
|-----|---------|---------|
| `AGENT` | `mini-swe-agent` | Pier agent |
| `N_CONCURRENT` | `1` | Pier `-n` (tasks in parallel per model) |
| `MAX_JOBS` | `1` | How many models run at once |
| `MAX_RETRIES` | `2` | Pier `-r` |
| `OVERRIDE_CPUS` | `2` | Task container CPUs |
| `OVERRIDE_MEMORY_MB` | `4096` | Task container memory |
| `TB_DIR` | `/root/terminal-bench-2-1` | Task clone location |

```bash
MAX_JOBS=2 N_CONCURRENT=2 bash run_tb_pier.sh
```

Edit `MODELS=(...)` in `run_tb_pier.sh` to run a subset (smoke with one model first).

## Notes

- Needs Docker (droplet). First run pulls large task images.
- Produces per-task **reward / score** artifacts for evidence ingest.
- Does **not** populate optimizer per-task `token_usage` (same as prior Pier TB waves).
