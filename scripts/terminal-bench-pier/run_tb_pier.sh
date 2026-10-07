#!/usr/bin/env bash
# Terminal-Bench 2.1 via Pier --env docker on a droplet.
# Models hit DO Serverless Inference via OPENAI_* pointing at OPENROUTER_*.
set -euo pipefail

OR_BENCH="$(cd "$(dirname "$0")" && pwd)"
set -a; source "$OR_BENCH/.env"; set +a
export PATH="/root/pier-venv/bin:${PATH}"

export OPENAI_API_KEY="${OPENROUTER_API_KEY}"
export OPENAI_BASE_URL="${OPENROUTER_BASE_URL}"
export OPENAI_API_BASE="${OPENROUTER_BASE_URL}"
export EVAL_API_KEY="${OPENROUTER_API_KEY}"
export EVAL_BASE_URL="${OPENROUTER_BASE_URL}"
export EVAL_MODEL="${EVAL_MODEL:-openai/openai-gpt-6-astra}"
export PYTHONUNBUFFERED=1

PIER="${PIER:-$(command -v pier)}"
: "${PIER:?pier not found}"

TB_DIR="${TB_DIR:-/root/terminal-bench-2-1}"
TB_COMMIT="${TB_COMMIT:-c5ee500c185224c97cd6caff7866a990a0057f41}"
TB_TASKS="${TB_TASKS:-$TB_DIR/tasks}"

if [[ ! -d "$TB_DIR/.git" ]]; then
  git clone --filter=blob:none "https://github.com/harbor-framework/terminal-bench-2-1.git" "$TB_DIR"
fi
git -C "$TB_DIR" fetch --depth=1 origin "$TB_COMMIT" 2>/dev/null \
  || git -C "$TB_DIR" fetch origin "$TB_COMMIT"
git -C "$TB_DIR" checkout --force "$TB_COMMIT"

: "${TB_TASKS:?missing $TB_TASKS}"
[[ -d "$TB_TASKS" ]] || { echo "ERROR: missing $TB_TASKS" >&2; exit 1; }

MODELS=(
  openai/openai-gpt-6-astra
  openai/anthropic-claude-fable-5.1
  openai/anthropic-claude-opus-5
  openai/anthropic-claude-5-sonnet
  openai/glm-5.3
  openai/kimi-k3
  openai/deepseek-v4-pro
  openai/qwen3.8-max
)

AGENT="${AGENT:-mini-swe-agent}"
N_CONCURRENT="${N_CONCURRENT:-1}"
MAX_JOBS="${MAX_JOBS:-1}"
MAX_RETRIES="${MAX_RETRIES:-2}"
OVERRIDE_CPUS="${OVERRIDE_CPUS:-2}"
OVERRIDE_MEMORY_MB="${OVERRIDE_MEMORY_MB:-4096}"
STAMP=$(date +%Y%m%d-%H%M%S)
LOG_DIR="$OR_BENCH/logs/tb-pier-$STAMP"
OUT_ROOT="$OR_BENCH/outputs/tb-pier-$STAMP"
mkdir -p "$LOG_DIR" "$OUT_ROOT"
: >"$LOG_DIR/queue.log"

echo "Terminal-Bench Pier -> $LOG_DIR (n=$N_CONCURRENT max_jobs=$MAX_JOBS cpus=$OVERRIDE_CPUS)"

wait_under_cap() {
  while true; do
    local n
    n=$(jobs -rp | wc -l | tr -d ' ')
    if (( n < MAX_JOBS )); then
      break
    fi
    sleep 10
  done
}

for model in "${MODELS[@]}"; do
  wait_under_cap
  safe=${model//\//_}
  out="$LOG_DIR/${safe}.log"
  job_out="$OUT_ROOT/$safe"
  mkdir -p "$job_out"
  echo "[$(date -u +%H:%M:%S)] START terminal_bench $model" | tee -a "$LOG_DIR/queue.log"
  (
    if "$PIER" run \
      -p "$TB_TASKS" \
      -a "$AGENT" \
      -m "$model" \
      -e docker \
      -n "$N_CONCURRENT" \
      -y \
      -r "$MAX_RETRIES" \
      --cpus ignore \
      --memory ignore \
      --override-cpus "$OVERRIDE_CPUS" \
      --override-memory-mb "$OVERRIDE_MEMORY_MB" \
      -o "$job_out" \
      >"$out" 2>&1; then
      echo "[$(date -u +%H:%M:%S)] OK    terminal_bench $model" | tee -a "$LOG_DIR/queue.log"
    else
      echo "[$(date -u +%H:%M:%S)] FAIL  terminal_bench $model -> $out" | tee -a "$LOG_DIR/queue.log"
    fi
  ) &
done

echo "launched ${#MODELS[@]} TB jobs (cap $MAX_JOBS); waiting..." | tee -a "$LOG_DIR/queue.log"
wait
echo "all TB pier jobs finished" | tee -a "$LOG_DIR/queue.log"
