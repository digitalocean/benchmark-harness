# OpenRouter Benchmark Harness

OpenRouter's internal benchmarking harness, externalized for transparency. We port benchmarks here so we can run them scalably on our infrastructure and iterate quickly.

```sh
bun install
OPENROUTER_API_KEY=... bun run bench -- --benchmark gpqa_diamond --model openai/gpt-4o-mini --limit 5
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Running GPQA against DigitalOcean's inference-proxy (`fix/do-inference-proxy-support`)

This branch/fork fixes two things needed to point the harness at an OpenAI-compatible
endpoint other than openrouter.ai -- see [PR #1](https://github.com/jdigitalocean/benchmark-harness/pull/1)
for details. To run it yourself:

```sh
git clone git@github.com:jdigitalocean/benchmark-harness.git
cd benchmark-harness
git checkout fix/do-inference-proxy-support
bun install
```

You'll need a DigitalOcean MODEL_ACCESS_KEY for the inference-proxy (ask your
team lead if you don't have one -- it's *not* a real openrouter.ai key, despite
the env var name below).

```sh
OPENROUTER_API_KEY=<your DO MODEL_ACCESS_KEY> \
OPENROUTER_BASE_URL=https://inference.do-ai.run/v1 \
bun run bench -- --benchmark gpqa_diamond --model kimi-k3 --epochs 3

# For high concurency
bun run bench -- --benchmark gpqa_diamond --model kimi-k3 --epochs 3 --concurrency 16
```

- `--model` is the raw model id as DO's inference-proxy expects it (e.g. `kimi-k3`) -- no `openrouter/` prefix.
- Swap `inference.do-ai.run` for `inference.do-ai-test.run` to run against the test environment instead of prod.
- Add `--limit N` to cap the number of questions for a quick smoke test before committing to a full run.
- Results are written to `bench-results/` as parquet, and the run summary (accuracy, token usage, per-sample scores) prints to stdout as JSON.
- To convert a parquet result file to a readable markdown report:

```sh
bun src/cli/parquet-to-md.ts bench-results/<filename>.parquet > bench-results/<filename>.md
```

### Capturing transient errors (5xx, decode failures)

Transient errors (HTTP 503s, decode errors, retries) are logged to stderr during the run but **not** persisted in the parquet results. To capture them, redirect stderr to a log file:

```sh
bun run bench -- --benchmark gpqa_diamond --model kimi-k3 --epochs 3 --concurrency 16 2> bench-results/run.log
```

To get a quick summary of 5xx error rates from the log:

```sh
# Total retry count
grep -c "Retrying after transient error" bench-results/run.log

# 5xx errors specifically
grep -c "error_status: 503" bench-results/run.log

# Decode errors (200 OK but unreadable body)
grep -c "Decode error" bench-results/run.log
```
