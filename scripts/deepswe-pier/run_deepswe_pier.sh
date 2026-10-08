#!/usr/bin/env bash
# DeepSWE v1.1 via Pier --env docker on a droplet.
# Models hit DO Serverless Inference via OPENAI_* pointing at OPENROUTER_*.
# After each model job, extracts per-task token_usage for optimizer evidence schema 0.1.
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
PYTHON="${PYTHON:-python3}"

# Evidence / prior Pier DeepSWE waves used this pin (113 tasks, v1.1).
DEEP_SWE_DIR="${DEEP_SWE_DIR:-/root/deep-swe}"
DEEP_SWE_COMMIT="${DEEP_SWE_COMMIT:-0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea}"
DEEP_SWE_TASKS="${DEEP_SWE_TASKS:-$DEEP_SWE_DIR/tasks}"

if [[ ! -d "$DEEP_SWE_DIR/.git" ]]; then
  git clone --filter=blob:none "https://github.com/datacurve-ai/deep-swe.git" "$DEEP_SWE_DIR"
fi
git -C "$DEEP_SWE_DIR" fetch --depth=1 origin "$DEEP_SWE_COMMIT" 2>/dev/null \
  || git -C "$DEEP_SWE_DIR" fetch origin "$DEEP_SWE_COMMIT"
git -C "$DEEP_SWE_DIR" checkout --force "$DEEP_SWE_COMMIT"

: "${DEEP_SWE_TASKS:?missing $DEEP_SWE_TASKS}"
[[ -d "$DEEP_SWE_TASKS" ]] || { echo "ERROR: missing $DEEP_SWE_TASKS" >&2; exit 1; }

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
MAX_JOBS="${MAX_JOBS:-2}"
MAX_RETRIES="${MAX_RETRIES:-2}"
# Droplet often 8 CPU / 16GB; Harbor tasks may request more — clamp.
OVERRIDE_CPUS="${OVERRIDE_CPUS:-4}"
OVERRIDE_MEMORY_MB="${OVERRIDE_MEMORY_MB:-8192}"
STAMP=$(date +%Y%m%d-%H%M%S)
LOG_DIR="$OR_BENCH/logs/deepswe-pier-$STAMP"
OUT_ROOT="$OR_BENCH/outputs/deepswe-pier-$STAMP"
EXTRACTOR="$OR_BENCH/extract_deepswe_pier_usage.py"
mkdir -p "$LOG_DIR" "$OUT_ROOT"
: >"$LOG_DIR/queue.log"

echo "DeepSWE Pier -> $LOG_DIR (tasks=$DEEP_SWE_TASKS n=$N_CONCURRENT max_jobs=$MAX_JOBS cpus=$OVERRIDE_CPUS)"
echo "Per-task usage extract: $EXTRACTOR"

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

extract_usage() {
  local job_out="$1"
  local model="$2"
  if ! find "$job_out" -type f -name result.json 2>/dev/null | grep -q .; then
    echo "[$(date -u +%H:%M:%S)] WARN  no result.json under $job_out for $model" | tee -a "$LOG_DIR/queue.log"
    return 1
  fi
  "$PYTHON" "$EXTRACTOR" "$job_out" 2>&1 | tee -a "$LOG_DIR/usage-extract.log"
}

for model in "${MODELS[@]}"; do
  wait_under_cap
  safe=${model//\//_}
  out="$LOG_DIR/${safe}.log"
  job_out="$OUT_ROOT/$safe"
  mkdir -p "$job_out"
  echo "[$(date -u +%H:%M:%S)] START deep_swe $model" | tee -a "$LOG_DIR/queue.log"
  (
    pier_ok=0
    if "$PIER" run \
      -p "$DEEP_SWE_TASKS" \
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
      pier_ok=1
      echo "[$(date -u +%H:%M:%S)] OK    deep_swe $model" | tee -a "$LOG_DIR/queue.log"
    else
      echo "[$(date -u +%H:%M:%S)] FAIL  deep_swe $model -> $out" | tee -a "$LOG_DIR/queue.log"
    fi
    if extract_usage "$job_out" "$model"; then
      echo "[$(date -u +%H:%M:%S)] USAGE deep_swe $model -> $job_out/**/evidence/per_task_usage.jsonl" | tee -a "$LOG_DIR/queue.log"
    else
      echo "[$(date -u +%H:%M:%S)] USAGE_FAIL deep_swe $model" | tee -a "$LOG_DIR/queue.log"
    fi
    exit $((1 - pier_ok))
  ) &
done

echo "launched ${#MODELS[@]} DeepSWE jobs (cap $MAX_JOBS); waiting..." | tee -a "$LOG_DIR/queue.log"
wait
echo "all DeepSWE pier jobs finished" | tee -a "$LOG_DIR/queue.log"
echo "Collect evidence: $OUT_ROOT/*/evidence/per_task_usage.jsonl" | tee -a "$LOG_DIR/queue.log"
