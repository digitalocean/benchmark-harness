# Benchmark Harness Known Bugs

This is a living register of confirmed defects observed while developing or operating this repository. Add new entries when they are reproduced. Keep fixed entries for regression history, and never include credentials or private benchmark data.

## BH-001: DigitalOcean Responses terminal events were discarded

**Status:** Fixed locally on 2026-09-23; deployment pending

**Affected area:** `src/providers/responses-client.ts`

DigitalOcean returned a valid streamed `response.completed` event, but fields such as `store`, `text`, and function-call `namespace` were `null`, while some fields expected by `@openrouter/sdk` were absent. The SDK classified the event as unknown. The harness's fallback then passed it through the same strict SDK validation and discarded it, eventually reporting:

`Stream ended without a response.completed event`

The fallback now accepts the minimally validated raw terminal response when SDK normalization cannot represent it. A regression test covers the observed DigitalOcean GLM response shape.

## BH-002: A run can succeed when every evaluation was skipped

**Status:** Open

**Affected area:** `src/server/run-registry.ts`

When model failures are exhausted, evaluations can be serialized with score `S` and the benchmark child process can exit with code 0. Run status resolution currently treats any zero exit code as success, even when `completedEvaluations` is zero and every evaluation was skipped. This produces a misleading successful run with no valid benchmark result.

Expected behavior: a run with no completed evaluations, or an incomplete result set, should fail or use a distinct partial/inconclusive status.

## BH-003: `completionTimeoutMs` is ignored by the Responses provider

**Status:** Fixed locally on 2026-09-28; deployment pending

**Affected area:** `src/providers/responses-model.ts`

Responses-based benchmarks can configure `completionTimeoutMs`, and the value appears in the effective solver configuration. Previously, the Responses provider only applied `timeoutMs`, so the configured completion timeout did not bound a Responses request.

Expected behavior: define and enforce the same timeout semantics for Responses requests as for the other model provider, with a regression test for an unfinished stream.

The Responses provider now applies `timeoutMs` to the initial SDK request and
enforces `completionTimeoutMs` across the complete streamed attempt. Deep SWE,
SWE-bench Verified, and all SWE Atlas tracks forward both settings.

## BH-004: Repository typecheck fails in TAU Airline tests

**Status:** Open

**Affected area:** `src/benchmarks/tau-bench-airline/airline.test.ts`

The strict Effect typecheck reports missing `CheckpointStore` and `ProgressReporter` services in tests around the empty-agent-response behavior (currently near lines 295 and 375). This prevents the repository-wide `bun run typecheck` validation from passing even though the production build succeeds.

Expected behavior: provide the required test services or construct the solver through the standard test layer.

## BH-005: A Terminal-Bench test depends on private GitHub SSH access

**Status:** Open test-portability issue

**Affected area:** Terminal-Bench test fixtures

The full test suite can fail while cloning a Terminal-Bench fixture when the machine does not have the required private GitHub SSH access. This makes an otherwise local test suite depend on developer-specific credentials.

Expected behavior: use a public or local deterministic fixture, or mark the credential-dependent case as an explicit integration test.

## BH-006: DigitalOcean output items cannot be reused for the next Responses turn

**Status:** Fixed locally on 2026-09-23; deployment pending

**Affected area:** `src/providers/responses-model.ts`

After a DigitalOcean model successfully returns one or more function calls, the agent loop appends those output items to the conversation for the next request. DigitalOcean includes `null` for optional fields such as function-call `namespace` and output-text `logprobs`. The OpenRouter SDK's outbound request schema expects those fields to be omitted rather than `null`, so it rejects the next request locally with `Input validation failed`.

Expected behavior: normalize provider output items into valid Responses input items before reusing them. Optional `null` fields should be omitted while required function-call identifiers, arguments, names, and message content are preserved. Add a multi-turn regression test using the observed DigitalOcean response shape.

The Responses input conversion now omits provider-supplied `null` fields recursively while preserving opaque function arguments and outputs. A regression test sends the observed DigitalOcean assistant message, function call, and function result through the SDK.

## BH-007: Outbound SDK validation failures are retried as transient server errors

**Status:** Fixed locally on 2026-09-23; deployment pending

**Affected area:** `src/providers/responses-client.ts`

An `SDKValidationError` raised before an HTTP request is currently converted to a retryable status 500 model error. Because the payload cannot change between attempts, the harness repeats the same deterministic local failure through all configured retries.

Expected behavior: classify outbound request validation failures as non-retryable client errors, while preserving retry behavior for genuinely transient response or network failures.

Outbound SDK input validation failures are now reported as non-retryable status 400 errors. SDK response validation remains retryable.

## BH-008: Terminal-Bench ORI Parquet output can omit generation time

**Status:** Open

**Affected area:** `src/benchmarks/terminal-bench/ori-parquet.test.ts`

The repository-wide test suite currently produces a Terminal-Bench ORI result with `sample_generation_time_ms` set to `null`, although the completeness test requires that field.

Expected behavior: propagate the ORI agent generation duration into the sample result, or explicitly classify the column as unavailable when the harness cannot provide it.

## BH-009: Terminal-Bench PI rewrites DigitalOcean model identifiers

**Status:** Fixed locally on 2026-09-24; deployment pending

**Affected area:** `src/benchmarks/agent-cli/runner.ts`, `src/benchmarks/agent-cli/harness.ts`

For Terminal-Bench runs using the DigitalOcean inference endpoint, the harness passed an unqualified model identifier such as `glm-5.3-flash` to `ori pi`. PI resolved the unknown identifier against its built-in OpenRouter catalog and silently selected a different model, observed as `z-ai/glm-5.3-flashx`. DigitalOcean then returned `404 model not found`, the agent made no task changes, and the verifier correctly scored the evaluation as incorrect.

DigitalOcean PI runs now register a dedicated OpenAI Responses-compatible provider and invoke PI directly with an explicit provider and the exact requested model ID. OpenRouter runs continue to use ORI. Regression coverage verifies exact model preservation and strict DigitalOcean hostname matching.
