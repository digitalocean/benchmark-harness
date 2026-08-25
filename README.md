# OpenRouter Benchmark Harness

OpenRouter's internal benchmarking harness, externalized for transparency. We port benchmarks here so we can run them scalably on our infrastructure and iterate quickly.

```sh
bun install
OPENROUTER_API_KEY=... bun run bench -- --benchmark gpqa_diamond --model openai/gpt-4o-mini --limit 5
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Running GPQA against DigitalOcean's inference-proxy (`fix/do-inference-proxy-support`)

This branch/fork fixes two things needed to point the harness at an OpenAI-compatible endpoint other than openrouter.ai -- see [PR #1](https://github.com/jdigitalocean/benchmark-harness/pull/1) for details. To run it yourself:

```sh
git clone git@github.com:jdigitalocean/benchmark-harness.git
cd benchmark-harness
git checkout fix/do-inference-proxy-support
bun install
```

You'll need a DigitalOcean MODEL_ACCESS_KEY for the inference-proxy (ask your team lead if you don't have one -- it's _not_ a real openrouter.ai key, despite the env var name below).

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

## GPQA and TAU benchmark API

The API accepts GPQA Diamond and TAU Bench Verified Airline runs. Omit
`benchmark` to default to GPQA Diamond. Configure the server with an API token,
DigitalOcean Managed MySQL, and a private DigitalOcean Spaces bucket:

```sh
export BENCH_API_TOKEN='secret'
export BENCH_RUN_TRIGGER_SECRET='replace-me'
export BENCH_API_MAX_RUNS='3'
# DigitalOcean personal access token with the genai:read scope. Used only by
# the server to populate the production/test model selector; never sent to browsers.
export DO_MODEL_CATALOG_TOKEN='replace-me'
# OpenRouter API key used only to list DigitalOcean-hosted OpenRouter models.
# Its successful catalog response is cached by the server for two hours.
export OPENROUTER_MODEL_CATALOG_TOKEN='replace-me'
# Optional TAU Airline user-simulator endpoint. When the API key is set, TAU
# uses this independent OpenAI-compatible endpoint for its simulated customer.
export TAU_AIRLINE_USER_SIMULATOR_API_KEY='replace-me'
export TAU_AIRLINE_USER_SIMULATOR_BASE_URL='https://generativelanguage.googleapis.com/v1beta/openai'
export TAU_AIRLINE_USER_SIMULATOR_MODEL='gemini-2.5-flash'

export MYSQL_HOST='replace-me.db.ondigitalocean.com'
export MYSQL_PORT='25060'
export MYSQL_USER='doadmin'
export MYSQL_PASSWORD='replace-me'
export MYSQL_DATABASE='defaultdb'
export MYSQL_SSL_MODE='required'
# For certificate verification, use MYSQL_SSL_MODE='verify-ca' and set
# MYSQL_CA_CERT_PATH to the downloaded DigitalOcean CA certificate.

export SPACES_ENDPOINT='https://nyc3.digitaloceanspaces.com'
export SPACES_REGION='nyc3'
export SPACES_BUCKET='model-benchmarks-do-not-delete'
export SPACES_ACCESS_KEY_ID='replace-me'
export SPACES_SECRET_ACCESS_KEY='replace-me'
export SPACES_PREFIX='benchmark-runs'
# Set SPACES_FORCE_PATH_STYLE=1 only for local S3-compatible test servers.

bun run serve
```

MySQL stores queryable run metadata and is required for API startup and lifecycle updates. `BENCH_RUN_TRIGGER_SECRET` independently protects run creation and is required in the `X-Bench-Run-Secret` header. At most three runs can be active; `BENCH_API_MAX_RUNS` may lower but cannot raise that cap. Every run requires a `triggeredByEmail` ending in `@digitalocean.com`, which is persisted with its metadata. `MYSQL_SSL_MODE` accepts `required`, `verify-ca`, or `disabled`; use `disabled` only for local development. Inference base URLs are currently unrestricted. The inference API key is accepted in the run payload, passed only to the benchmark child process, and never returned, logged, or persisted.

Open `http://<server>:8080/gpqa-benchmarks` for the runs dashboard. Enter `BENCH_API_TOKEN` in the browser to start or cancel GPQA or TAU runs and view model, base URL, status, live CLI completion percentage and completed/skipped evaluation counts, Parquet accuracy as the quality score, and full run artifacts. Evaluation totals include all epochs, so 198 GPQA questions over three epochs display as 594 evaluations. The token is kept in tab-scoped session storage and is not placed in URLs.

Logs, run state, and inference request events can be viewed or downloaded while a run is active. A download taken during execution is a snapshot of the file currently stored on the Droplet; download it again to include newer entries.

Start a run:

```sh
curl -X POST http://127.0.0.1:8080/runs \
  -H "Authorization: Bearer ${BENCH_API_TOKEN}" \
  -H "X-Bench-Run-Secret: ${BENCH_RUN_TRIGGER_SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{
    "benchmark": "gpqa_diamond",
    "triggeredByEmail": "user@digitalocean.com",
    "inference": {
      "baseUrl": "https://inference.do-ai.run/v1",
      "apiKey": "replace-me",
      "model": "kimi-k3",
      "maxTokens": 8192,
      "reasoningEffort": "high",
      "timeoutMs": 120000
    },
    "execution": {
      "epochs": 10,
      "concurrency": 8,
      "unordered": true,
      "limit": 198,
      "maxRetries": 6
    }
  }'
```

Set `"benchmark": "tau_bench_verified_airline"` to run the 50-task TAU Bench Verified Airline suite; it uses a fixed temperature of `0`. If `TAU_AIRLINE_USER_SIMULATOR_API_KEY` is configured, its model, base URL, and key are used for TAU's simulated customer while `inference` continues to configure the evaluated agent model. Optional inference fields are `endpointId`, `costTier`, `sort`, `cloudflareVersion`, `costQualityTradeoff`, and `pinModel`. Execution can use `start` plus either `end` or `limit`. Set `execution.unordered` to `true` for rolling concurrency without input-order head-of-line blocking; omitted or `false` preserves ordered result emission.

Authenticated endpoints:

- `GET /runs` and `GET /runs/:id` — MySQL-backed run and upload metadata
- `GET /model-catalog?baseUrl=<supported inference URL>` — filtered model IDs for the dashboard selector
- `GET /runs/:id/logs` — combined process output
- `GET /runs/:id/state` — local restart-recovery state
- `GET /runs/:id/request-records` — raw inference request-event JSONL
- `GET /runs/:id/parquet` — Parquet result file
- `GET /runs/:id/summary` — detailed Parquet-derived run summary
- `GET /runs/:id/results` — Parquet metadata
- `POST /runs/:id/cancel` — request cancellation
- `POST /runs/:id/disable` — hide a run from the dashboard by default; send
  `{"disabled": false}` to re-enable it
- `GET /results` and `GET /summary` — results across API runs

Each active terminal run is written locally under `logs/api/<run-id>/`. After it finishes, its artifacts are uploaded privately to:

```text
s3://<bucket>/<prefix>/<benchmark-folder>/YYYY/MM/DD/<run-id>/
  run.json
  manifest.json
  logs/run.log
  requests/requests.jsonl
  results/*.parquet
```

`<benchmark-folder>` is `gpqa` for GPQA Diamond and
`tau_bench_verified_airline` for TAU Bench Verified Airline.

The request JSONL writes a `started` event before each network attempt and a `completed` event when the attempt terminates. The dashboard correlates them so interrupted attempts remain visible as pending. Records include request summary, start and completion timestamps, duration, HTTP status, and error details. Successful response bodies and full prompt payloads are not stored; failed non-200/201 response bodies are retained for diagnosis. The run log remains focused on general benchmark output, retries, warnings, and failures. Large artifacts use multipart uploads; transient upload failures retry with a fresh file stream and record the HTTP status, Spaces request IDs, and nested error details in the API log and `uploadError`. Benchmark status and artifact-upload status are independent: a valid Parquet containing every expected non-skipped evaluation is successful even when the Spaces upload fails. The dashboard shows a compact warning icon beside such a run with the upload error available on hover. `manifest.json` is uploaded last and acts as the completion marker. Completed run views and summaries read from Spaces, and dashboard downloads use five-minute signed Spaces URLs so file data does not pass through the Droplet. After MySQL confirms the completed upload metadata, the server removes the local logs, requests, Parquet, progress, and manifest files while retaining only the small restart-recovery `run.json`. Failed or in-progress uploads remain local and continue to use local live snapshots. MySQL contains run configuration, model, lifecycle timestamps, status, and Spaces pointers; it never contains inference credentials or full artifacts.

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
