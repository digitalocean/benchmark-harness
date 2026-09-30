# Benchmark Harness HTTP API

This document is the consumer-facing specification for the benchmark service.
The API is currently unversioned.

## Conventions

Set the service URL and API token before using the examples:

```bash
export BENCH_API_BASE_URL="http://127.0.0.1:8080"
export BENCH_API_TOKEN="..."
```

Except where explicitly noted, every request requires:

```http
Authorization: Bearer <BENCH_API_TOKEN>
```

JSON requests also require:

```http
Content-Type: application/json
```

The following operations additionally require:

```http
X-Bench-Run-Secret: <BENCH_RUN_TRIGGER_SECRET>
```

- `POST /runs`
- `POST /runs/{id}/diagnostic-retries`
- `POST /runs/{id}/gpqa-retry-comparisons`
- `POST /runs/{id}/gpqa-retry-comparisons/{comparisonId}/cancel`

Timestamps are ISO 8601 strings. Run statuses are `running`, `succeeded`,
`failed`, or `cancelled`. Artifact upload statuses are `pending`, `uploading`,
`complete`, or `failed`.

Errors normally use this shape:

```json
{
  "error": "Human-readable error"
}
```

Common response codes are:

- `200`: successful read or update
- `202`: asynchronous run or retry accepted
- `400`: invalid request
- `401`: missing or invalid API bearer token
- `403`: missing or invalid run-trigger secret
- `404`: run, retry, report, or artifact not found
- `409`: requested operation is unavailable for the run
- `422`: the artifact exists but does not contain reportable data
- `429`: active-run or retry concurrency limit reached
- `500`: report or summary generation failed
- `503`: model catalog or metadata storage unavailable

## Public endpoints

### `GET /health`

Does not require authentication.

Response:

```json
{
  "ok": true,
  "activeRuns": 2
}
```

### `GET /gpqa-benchmarks`

Returns the HTML dashboard shell. The dashboard's API requests still require
the bearer token entered by the user.

## Runs

### `POST /runs`

Starts a benchmark asynchronously. Requires both authentication headers.

Supported benchmarks:

- `gpqa_diamond`
- `tau_bench_verified_airline`
- `deep_swe`
- `swe_bench_verified`
- `terminal_bench`
- `swe_atlas_qa`
- `swe_atlas_tw`
- `swe_atlas_rf`

Request:

```json
{
  "benchmark": "swe_bench_verified",
  "triggeredByEmail": "engineer@digitalocean.com",
  "inference": {
    "baseUrl": "https://inference.do-ai.run/v1",
    "apiKey": "<INFERENCE_API_KEY>",
    "model": "glm-5.3-flash",
    "temperature": 0,
    "maxTokens": 8192,
    "reasoningEffort": "high",
    "timeoutMs": 60000,
    "completionTimeoutMs": 3600000,
    "endpointId": "optional-endpoint-id",
    "costTier": "high",
    "sort": "throughput",
    "providerOnly": ["digitalocean"],
    "allowFallbacks": false,
    "cloudflareVersion": "optional-version",
    "costQualityTradeoff": 5,
    "pinModel": true
  },
  "execution": {
    "epochs": 1,
    "concurrency": 1,
    "unordered": true,
    "limit": 10,
    "maxRetries": 6
  },
  "logLevel": "1"
}
```

For SWE Atlas runs, `judgeModel` may also be provided:

```json
{
  "benchmark": "swe_atlas_qa",
  "judgeModel": "qwen3.8-max"
}
```

The judge always uses the server-configured DigitalOcean inference endpoint and
key. `judgeModel` is ignored for non-SWE-Atlas benchmarks.

Inference constraints:

- `model` accepts letters, digits, `.`, `_`, `:`, `-`, and `/`.
- `temperature`: `0` through `2`
- `maxTokens`, `timeoutMs`, and `completionTimeoutMs`: positive integers
- `reasoningEffort`: `xhigh`, `high`, `medium`, `low`, `minimal`, or `none`
- `costTier`: `low`, `medium`, `high`, `xhigh`, or `max`
- `sort`: `price`, `throughput`, `latency`, or `exacto`
- `costQualityTradeoff`: integer from `0` through `10`

Execution constraints:

- `epochs`: `1` through `20`
- `concurrency`: `1` through `64`
- Sandbox benchmarks have a service limit of `6` concurrent workers.
- `limit`: `1` through `1000`
- `start`: `0` through `999`
- `end`: `1` through `1000`
- `maxRetries`: `0` through `20`
- `limit` and `end` cannot be used together.
- `end` must be greater than `start`, which defaults to `0`.

Defaults:

- GPQA and TAU: `epochs=3`, `concurrency=3`
- Sandbox benchmarks: `epochs=1`, `concurrency=1`
- `temperature=1` for GPQA and `0` for other benchmarks
- `reasoningEffort=high`
- `completionTimeoutMs=3600000`
- `maxRetries=6`

The inference API key is launch-only and is not persisted.

Successful response: `202 Accepted`. The response is the accepted run record;
consumers should retain its `id` and poll `GET /runs/{id}`.

### `GET /runs`

Returns all persisted top-level benchmark runs, newest first. This unpaginated
form does not apply query filters.

Response:

```json
[
  {
    "id": "run-id",
    "status": "succeeded",
    "args": {},
    "startedAt": "2026-09-30T00:00:00.000Z",
    "finishedAt": "2026-09-30T01:00:00.000Z",
    "qualityScore": 0.75,
    "uploadStatus": "complete"
  }
]
```

The actual metadata objects include configuration, progress, failure, upload,
and artifact-location fields described under `GET /runs/{id}`.

### `GET /runs?view=page`

Returns filtered, paginated run metadata, newest first. This is the recommended
endpoint for discovering run IDs.

Query parameters:

- `page`: positive integer; default `1`
- `pageSize`: positive integer; default `50`, maximum `100`
- `benchmark`: exact benchmark ID
- `model`: case-insensitive model substring
- `modelExact=1`: makes `model` an exact, case-insensitive match
- `status`: `running`, `succeeded`, `failed`, `cancelled`, or `all`
- `durationGt`: runs lasting more than this many seconds
- `triggeredBy`: case-insensitive email substring
- `qualityLt`: quality percentage threshold, such as `50`
- `hideCanary=1`: excludes canary runs
- `canaryOnly=1`: includes only canary runs
- `fullSuiteOnly=1`: excludes runs whose explicit `limit` is smaller than the
  benchmark's full dataset
- `showDisabled=1`: includes disabled runs; disabled runs are hidden by default

Example: latest successful runs for an exact model:

```bash
curl -fsS -G "$BENCH_API_BASE_URL/runs" \
  -H "Authorization: Bearer $BENCH_API_TOKEN" \
  --data-urlencode "view=page" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=10" \
  --data-urlencode "status=succeeded" \
  --data-urlencode "model=glm-5.3-flash" \
  --data-urlencode "modelExact=1"
```

Example: latest successful full-suite runs for a benchmark:

```bash
curl -fsS -G "$BENCH_API_BASE_URL/runs" \
  -H "Authorization: Bearer $BENCH_API_TOKEN" \
  --data-urlencode "view=page" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=10" \
  --data-urlencode "status=succeeded" \
  --data-urlencode "benchmark=swe_bench_verified" \
  --data-urlencode "fullSuiteOnly=1"
```

Response:

```json
{
  "runs": [],
  "page": 1,
  "pageSize": 10,
  "total": 0,
  "totalPages": 1,
  "summary": {
    "total": 0,
    "running": 0,
    "failed": 0
  }
}
```

### `GET /runs/{id}`

Returns persisted metadata and a precomputed performance report when available.

Important fields:

```json
{
  "id": "run-id",
  "status": "succeeded",
  "args": {
    "benchmark": "gpqa_diamond",
    "triggeredByEmail": "engineer@digitalocean.com",
    "inference": {
      "baseUrl": "https://inference.do-ai.run/v1",
      "model": "glm-5.3-flash",
      "temperature": 1,
      "reasoningEffort": "high",
      "completionTimeoutMs": 3600000
    },
    "execution": {
      "epochs": 3,
      "concurrency": 3,
      "unordered": true,
      "maxRetries": 6
    }
  },
  "startedAt": "2026-09-30T00:00:00.000Z",
  "finishedAt": "2026-09-30T01:00:00.000Z",
  "exitCode": 0,
  "expectedQuestions": 198,
  "completedQuestions": 198,
  "skippedQuestions": 0,
  "completionPercentage": 100,
  "totalEvaluations": 594,
  "completedEvaluations": 594,
  "skippedEvaluations": 0,
  "qualityScore": 0.75,
  "disabled": false,
  "cancelRequestedAt": null,
  "failureReason": null,
  "uploadStatus": "complete",
  "uploadError": null,
  "uploadedAt": "2026-09-30T01:01:00.000Z",
  "spacesBucket": "bucket-name",
  "spacesPrefix": "prefix/to/run",
  "manifestKey": "prefix/to/run/manifest.json",
  "triggeredByEmail": "engineer@digitalocean.com",
  "performanceReport": null
}
```

Inference credentials are never returned.

### `POST /runs/{id}/cancel`

Requests cancellation of an active run. Requires bearer authentication.

Response: the updated active run record.

### `POST /runs/{id}/disable`

Hides or restores a run in default dashboard and paginated-list results.
Requires bearer authentication.

Request:

```json
{
  "disabled": true
}
```

`disabled` defaults to `true`. Use `false` to restore the run.

Response: updated run metadata.

## Run artifacts

Completed artifacts are private. Consumers do not need direct bucket access.
When an artifact has been archived to Spaces, download endpoints can return a
five-minute signed URL in this response header:

```http
X-Artifact-Download-Url: https://...
```

For those responses, the API body is empty and the client must make a second
`GET` request to the signed URL. While an artifact is still local, the same API
endpoint returns the artifact bytes directly.

Example supporting both cases:

```bash
headers="$(mktemp)"
body="$(mktemp)"

curl -fsS \
  -H "Authorization: Bearer $BENCH_API_TOKEN" \
  -D "$headers" \
  -o "$body" \
  "$BENCH_API_BASE_URL/runs/<RUN_ID>/parquet"

signed_url="$(
  awk -F': ' 'tolower($1) == "x-artifact-download-url" {
    sub(/\r$/, "", $2)
    print $2
  }' "$headers"
)"

if [ -n "$signed_url" ]; then
  curl -fsSL "$signed_url" -o results.parquet
else
  mv "$body" results.parquet
fi
rm -f "$headers" "$body"
```

### `GET /runs/{id}/parquet`

Downloads the final raw Parquet result. This is the canonical endpoint for the
result dump and works for completed Spaces uploads through the signed-URL
mechanism above.

Local response content type:

```http
Content-Type: application/vnd.apache.parquet
```

### `GET /runs/{id}/results`

Returns an array of local Parquet file metadata:

```json
[
  {
    "runId": "run-id",
    "file": "result.parquet",
    "path": "logs/api/run-id/results/result.parquet",
    "bytes": 12345,
    "modifiedAt": "2026-09-30T01:00:00.000Z"
  }
]
```

This is a legacy metadata endpoint, not a download endpoint. Uploaded local
artifacts are deleted after archival, so this endpoint can return `[]` for an
archived run. Use `GET /runs/{id}/parquet` to obtain the actual result.

### `GET /runs/{id}/logs`

Returns plain-text run logs. Query parameters:

- `tail`: number of lines, default `200`, maximum `10000`
- `download=1`: requests the complete log as a download; archived runs use a
  signed URL

### `GET /runs/{id}/state`

Returns the restart-recovery run state as JSON.

Use `download=1` to request a download; archived runs use a signed URL.

### `GET /runs/{id}/request-records`

Returns inference request lifecycle records as NDJSON.

For a live or local run, `after=<byte-offset>` reads incrementally. The response
contains `X-Request-Log-Next-Offset`; it also contains
`X-Request-Log-Reset: 1` when the requested offset is past the current file.

Use `download=1` to request the complete file; archived runs use a signed URL.

Records include request summaries, timestamps, elapsed time, HTTP status, and
error details. Successful response bodies and full prompt payloads are
intentionally not stored.

### `GET /runs/{id}/summary`

Returns a JSON summary derived from the run Parquet:

```json
{
  "runId": "run-id",
  "file": "result.parquet",
  "task": "gpqa_diamond",
  "model": "glm-5.3-flash",
  "epochs": 3,
  "temperature": 1,
  "createdAt": "2026-09-30T00:00:00.000Z",
  "accuracy": 0.75,
  "correctAnswers": 148,
  "totalQuestions": 198,
  "skippedQuestions": 0,
  "evaluations": 594,
  "uniqueQuestions": 198,
  "skippedEvaluations": 0,
  "inputTokens": 0,
  "outputTokens": 0,
  "totalTokens": 0,
  "reasoningTokens": 0,
  "totalCost": 0,
  "generationTimeMs": 0,
  "epochResults": [],
  "subdomains": [],
  "failures": []
}
```

This endpoint reads archived Parquet through the service when necessary.

## Benchmark-specific reports

### `GET /runs/{id}/gpqa-report`

Available only for `gpqa_diamond`. Returns:

```json
{
  "runId": "run-id",
  "file": "result.parquet",
  "inference": {},
  "task": "gpqa_diamond",
  "model": "glm-5.3-flash",
  "totalGenerationTimeMs": 0,
  "evaluations": 594,
  "correct": 0,
  "incorrect": 0,
  "wrong": 0,
  "noAnswer": 0,
  "skipped": 0,
  "items": [
    {
      "sampleId": "sample-id",
      "epoch": 0,
      "status": "correct",
      "latencyMs": 1000,
      "prompt": "...",
      "question": "...",
      "choices": {
        "A": "...",
        "B": "...",
        "C": "...",
        "D": "..."
      },
      "modelAnswer": "...",
      "extractedAnswer": "A",
      "correctAnswer": "A",
      "correctAnswerText": "...",
      "reasoning": "...",
      "scorerExplanation": "...",
      "subdomain": "..."
    }
  ],
  "analytics": {}
}
```

Item status is `correct`, `wrong`, `no_answer`, or `skipped`. Add `download=1`
to request a JSON attachment.

### `GET /runs/{id}/tau-airline-report`

Available only for `tau_bench_verified_airline`. Returns:

```json
{
  "runId": "run-id",
  "file": "result.parquet",
  "task": "tau_bench_verified_airline",
  "model": "glm-5.3-flash",
  "totalGenerationTimeMs": 0,
  "evaluations": 150,
  "passed": 0,
  "failed": 0,
  "skipped": 0,
  "items": [
    {
      "sampleId": "sample-id",
      "taskId": "task-id",
      "epoch": 0,
      "status": "passed",
      "latencyMs": 1000,
      "reward": 1,
      "scenario": "...",
      "persona": "...",
      "purpose": "...",
      "expectedActions": [],
      "expectedCommunications": [],
      "expectedEnvironmentAssertions": [],
      "expectedNaturalLanguageAssertions": [],
      "rewardBasis": [],
      "actualToolCalls": [],
      "conversation": [],
      "finalAgentAnswer": "...",
      "terminationReason": "...",
      "stepCount": 1,
      "scorerExplanation": "...",
      "hasReasoning": true
    }
  ]
}
```

Item status is `passed`, `failed`, or `skipped`. Add `download=1` to request a
JSON attachment.

## Diagnostic single-item retries

Diagnostic retries support only GPQA Diamond and TAU Bench Verified Airline.
They do not modify the source run, score, Parquet, or Spaces artifacts. Jobs are
in memory and are not recovered after an API restart. At most three can run
concurrently.

### `POST /runs/{id}/diagnostic-retries`

Requires both authentication headers.

Request:

```json
{
  "sampleId": "sample-id",
  "originalEpoch": 0,
  "apiKey": "<INFERENCE_API_KEY>"
}
```

The source item must exist in the benchmark-specific report.

Response: `202 Accepted`

```json
{
  "id": "retry-id",
  "runId": "source-run-id",
  "benchmark": "gpqa_diamond",
  "sampleId": "sample-id",
  "originalEpoch": 0,
  "status": "running",
  "startedAt": "2026-09-30T00:00:00.000Z",
  "finishedAt": null,
  "result": null,
  "error": null
}
```

### `GET /runs/{id}/diagnostic-retries/{retryId}`

Polls the retry job. `status` is `running`, `succeeded`, or `failed`.
Successful jobs place the benchmark report item in `result`; failed jobs place
details in `error`.

## GPQA retry comparisons

GPQA retry comparisons select questions by their failure count across source
epochs. They create durable child runs and can compare the source configuration
with a second model or provider configuration.

The canonical path uses `gpqa-retry-comparisons`. The legacy
`gpqa-retry-campaigns` path is accepted as an alias.

### `GET /runs/{id}/gpqa-retry-comparisons`

Returns the source configuration, available failure bands, and existing
comparisons:

```json
{
  "sourceRunId": "source-run-id",
  "sourceEpochs": 3,
  "sourceInference": {},
  "sourceExecution": {},
  "bands": [
    {
      "failures": 3,
      "epochs": 3,
      "questionCount": 1,
      "sampleIds": ["sample-id"]
    }
  ],
  "comparisons": []
}
```

Use the returned `bands[].failures` values in `selectedFailureCounts`.

### `POST /runs/{id}/gpqa-retry-comparisons`

Starts a durable comparison. Requires both authentication headers.

Request:

```json
{
  "selectedFailureCounts": [3, 2],
  "triggeredByEmail": "engineer@digitalocean.com",
  "original": {
    "apiKey": "<ORIGINAL_INFERENCE_API_KEY>",
    "repetitions": 3,
    "concurrency": 3,
    "unordered": true,
    "maxRetries": 6
  },
  "comparison": {
    "apiKey": "<COMPARISON_INFERENCE_API_KEY>",
    "repetitions": 3,
    "concurrency": 3,
    "unordered": true,
    "maxRetries": 6,
    "inference": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "provider/model",
      "temperature": 1,
      "reasoningEffort": "high",
      "providerOnly": ["digitalocean"],
      "allowFallbacks": false
    }
  }
}
```

`selectedFailureCounts` must contain `1` through `20` entries, each from `1`
through `20`. `repetitions` is `1` through `20`; `concurrency` is `1` through
`64`; and `maxRetries` is `0` through `20`.

`comparison` is optional. `original.inference` is also optional and otherwise
inherits the source run's inference configuration.

Response: `202 Accepted`, containing the persisted comparison record.

### `GET /runs/{id}/gpqa-retry-comparisons/{comparisonId}`

Returns the comparison plus `originalRun` and `comparisonRun` metadata when
those child runs exist. Comparison status is `running`, `succeeded`, `failed`,
or `cancelled`.

### `POST /runs/{id}/gpqa-retry-comparisons/{comparisonId}/cancel`

Cancels running comparison arms. Requires both authentication headers.

Response: updated comparison metadata.

### `GET /runs/{id}/gpqa-retry-comparisons/{comparisonId}/report`

Returns the persisted side-by-side comparison report after the original arm has
started and report data is available. Add `download=1` for a JSON attachment.

## Catalog and aggregate endpoints

### `GET /model-catalog?baseUrl={url}`

Returns model IDs for a supported DigitalOcean or OpenRouter inference base
URL.

Example:

```bash
curl -fsS -G "$BENCH_API_BASE_URL/model-catalog" \
  -H "Authorization: Bearer $BENCH_API_TOKEN" \
  --data-urlencode "baseUrl=https://inference.do-ai.run/v1"
```

Response:

```json
{
  "baseUrl": "https://inference.do-ai.run/v1",
  "models": ["model-a", "model-b"]
}
```

### `GET /results`

Returns Parquet metadata across local and archived top-level runs, newest
artifact first:

```json
[
  {
    "runId": "run-id",
    "file": "result.parquet",
    "path": "s3://bucket/prefix/results/result.parquet",
    "bytes": 12345,
    "modifiedAt": "2026-09-30T01:00:00.000Z"
  }
]
```

The `path` is descriptive and does not grant bucket access. Download a run
through `GET /runs/{id}/parquet`.

### `GET /summary`

Returns a Markdown aggregate summary for Parquet files currently retained
locally by the API process:

```http
Content-Type: text/markdown; charset=utf-8
```

This endpoint is not the recommended way to consume archived results. Discover
runs with `GET /runs?view=page`, then use `GET /runs/{id}/summary` or
`GET /runs/{id}/parquet`.
