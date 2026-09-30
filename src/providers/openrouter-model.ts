import { HttpClient, HttpClientRequest } from "@effect/platform";
import type { ChatUsage } from "@openrouter/sdk/models";
import { ChatResult$inboundSchema } from "@openrouter/sdk/models/chatresult";
import { millis } from "effect/Duration";
import type { Effect } from "effect/Effect";
import {
  ensuring,
  fail,
  flatMap,
  gen,
  mapError,
  succeed,
  sync,
  tapError,
  timeout,
  catchTag,
} from "effect/Effect";
import type { Layer } from "effect/Layer";
import { effect } from "effect/Layer";
import { runForEach } from "effect/Stream";

import type {
  ChatMessage,
  ContentPart,
  ModelOutput,
  ModelUsage,
} from "../harness/core";
import { MessageRole, ModelError } from "../harness/core";
import type { GenerateConfig } from "../harness/model";
import { Model, stripVariantSuffix } from "../harness/model";
import type { ReasoningDetails } from "../harness/reasoning-details";
import { hasReasoningDetails } from "../harness/reasoning-details";
import { Either } from "../internal/either";
import { unknownErrorToString } from "../internal/errors";
import { isDefinedAndNotNull, isRecord } from "../internal/guards";
import { wLog } from "../internal/log";
import {
  logModelRequestCompleted,
  logModelRequestProgress,
  logModelRequestStarted,
} from "../internal/request-log";
import { parseSchema, z } from "../internal/zod";
import { recordGenerationId } from "../runtime/generation-ids";
import {
  buildResponseCacheSalt,
  getCurrentCallSalt,
  getCurrentEpoch,
  getCurrentRetryAttempt,
  getCurrentRunAttempt,
  logUnexpectedResponseCacheMiss,
  RESPONSE_CACHE_HEADER,
  RESPONSE_CACHE_SALT_HEADER,
  RESPONSE_CACHE_SOURCE_ID_HEADER,
  RESPONSE_CACHE_STATUS_HEADER,
  RESPONSE_CACHE_STATUS_HIT,
  RESPONSE_CACHE_TTL_HEADER,
  RESPONSE_CACHE_TTL_SECONDS,
} from "../runtime/response-cache";
import type { RetryConfig } from "../runtime/retry";
import { rateLimitRetrySchedule, retrySalted } from "../runtime/retry";
import {
  buildAutoRouterPlugin,
  toWireAutoRouterPlugin,
} from "./auto-router-plugin";
import type { ModelErrorIdentifiers } from "./request-identifiers";
import {
  appendModelErrorIdentifiers,
  modelErrorIdentifiersFromHeaders,
} from "./request-identifiers";

export const BENCH_HARNESS_APP_REFERRER =
  "https://bench-harness.openrouter.ai/";

export const BENCH_HARNESS_APP_TITLE = "OpenRouter: Bench Harness";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const LIVE_PROGRESS_INTERVAL_MS = 1000;
const REQUEST_BODY_LOG_LIMIT = 256_000;

export interface OpenRouterModelConfig {
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly sessionId?: string;
  readonly retry?: RetryConfig;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, "");
}

export function makeOpenRouterModelLayer(
  config: OpenRouterModelConfig
): Layer<Model, never, HttpClient.HttpClient> {
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? OPENROUTER_BASE_URL);
  return effect(Model)(
    gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return Model.of({
        generate: (messages, genConfig) =>
          generate(
            {
              model: config.model,
              messages,
              genConfig,
              sessionId: config.sessionId,
              apiKey: config.apiKey,
              baseUrl,
              retry: config.retry,
            },
            client
          ),
      });
    })
  );
}

function requestSummary(
  messageCount: number,
  genConfig: GenerateConfig
): Readonly<Record<string, unknown>> {
  return {
    messages: messageCount,
    stream: true,
    ...(genConfig.temperature !== undefined && {
      temperature: genConfig.temperature,
    }),
    ...(genConfig.maxTokens !== undefined && {
      max_tokens: genConfig.maxTokens,
    }),
    ...(genConfig.reasoningEffort !== undefined && {
      reasoning_effort: genConfig.reasoningEffort,
    }),
    ...(genConfig.endpointId !== undefined && {
      endpoint_id: genConfig.endpointId,
    }),
    ...(genConfig.timeoutMs !== undefined && {
      timeout_ms: genConfig.timeoutMs,
    }),
    ...(genConfig.completionTimeoutMs !== undefined && {
      completion_timeout_ms: genConfig.completionTimeoutMs,
    }),
  };
}

function requestBodyForLog(
  body: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const serialized = JSON.stringify(body);
  if (serialized.length <= REQUEST_BODY_LOG_LIMIT) {
    return body;
  }
  return {
    truncated: true,
    original_characters: serialized.length,
    preview: `${serialized.slice(0, REQUEST_BODY_LOG_LIMIT - 3)}...`,
  };
}

interface GenerateOpts {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly genConfig: GenerateConfig;
  readonly sessionId?: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly retry?: RetryConfig;
}

interface LiveResponseTrackerInput {
  readonly requestId: string;
  readonly sessionId?: string | undefined;
  readonly attempt: number;
  readonly model: string;
  readonly url: string;
  readonly startedAt: string;
  readonly startedAtMs: number;
  readonly status: number;
}

function makeLiveResponseTracker(input: LiveResponseTrackerInput): {
  readonly accept: (text: string, bytes: number) => void;
  readonly finish: (text?: string) => void;
} {
  let frameBuffer = "";
  let receivedBytes = 0;
  let emittedBytes = 0;
  let contentDelta = "";
  let reasoningDelta = "";
  let reasoningDetails: unknown;
  let toolCallDeltas: unknown[] = [];
  let timeToFirstOutputMs: number | undefined;
  let lastEmittedAtMs = input.startedAtMs;
  let emittedProgress = false;
  let emittedOutput = false;

  const processFrame = (frame: string): void => {
    const parsed = parseSseFrame(frame);
    if (!isRecord(parsed) || !Array.isArray(parsed["choices"])) {
      return;
    }
    for (const choice of parsed["choices"]) {
      if (!isRecord(choice)) {
        continue;
      }
      const source = isRecord(choice["delta"])
        ? choice["delta"]
        : choice["message"];
      if (!isRecord(source)) {
        continue;
      }
      if (typeof source["content"] === "string") {
        contentDelta += source["content"];
      }
      const reasoning =
        typeof source["reasoning"] === "string"
          ? source["reasoning"]
          : source["reasoning_content"];
      if (typeof reasoning === "string") {
        reasoningDelta += reasoning;
      }
      if (source["reasoning_details"] !== undefined) {
        reasoningDetails = source["reasoning_details"];
      }
      if (Array.isArray(source["tool_calls"])) {
        toolCallDeltas.push(...source["tool_calls"]);
      }
    }
    if (
      timeToFirstOutputMs === undefined &&
      (contentDelta.length > 0 ||
        reasoningDelta.length > 0 ||
        reasoningDetails !== undefined ||
        toolCallDeltas.length > 0)
    ) {
      timeToFirstOutputMs = performance.now() - input.startedAtMs;
    }
  };

  const drainFrames = (flush: boolean): void => {
    let separator = /\r?\n\r?\n/u.exec(frameBuffer);
    while (separator !== null) {
      processFrame(frameBuffer.slice(0, separator.index));
      frameBuffer = frameBuffer.slice(separator.index + separator[0].length);
      separator = /\r?\n\r?\n/u.exec(frameBuffer);
    }
    if (flush && frameBuffer.trim().length > 0) {
      processFrame(frameBuffer);
      frameBuffer = "";
    }
  };

  const emit = (force: boolean): void => {
    const now = performance.now();
    const hasOutput =
      contentDelta.length > 0 ||
      reasoningDelta.length > 0 ||
      reasoningDetails !== undefined ||
      toolCallDeltas.length > 0;
    const hasNewBytes = receivedBytes > emittedBytes;
    if (!(hasOutput || hasNewBytes)) {
      return;
    }
    if (
      !force &&
      emittedProgress &&
      !hasOutput &&
      now - lastEmittedAtMs < LIVE_PROGRESS_INTERVAL_MS
    ) {
      return;
    }
    if (
      !force &&
      emittedProgress &&
      emittedOutput &&
      now - lastEmittedAtMs < LIVE_PROGRESS_INTERVAL_MS
    ) {
      return;
    }
    logModelRequestProgress({
      requestId: input.requestId,
      sessionId: input.sessionId,
      attempt: input.attempt,
      model: input.model,
      url: input.url,
      startedAt: input.startedAt,
      observedAt: new Date().toISOString(),
      elapsedMs: now - input.startedAtMs,
      status: input.status,
      receivedBytes,
      ...(timeToFirstOutputMs !== undefined && { timeToFirstOutputMs }),
      ...(contentDelta.length > 0 && { contentDelta }),
      ...(reasoningDelta.length > 0 && { reasoningDelta }),
      ...(reasoningDetails !== undefined && { reasoningDetails }),
      ...(toolCallDeltas.length > 0 && { toolCallDeltas }),
    });
    emittedBytes = receivedBytes;
    contentDelta = "";
    reasoningDelta = "";
    reasoningDetails = undefined;
    toolCallDeltas = [];
    emittedProgress = true;
    emittedOutput ||= hasOutput;
    lastEmittedAtMs = now;
  };

  return {
    accept: (text, bytes) => {
      receivedBytes += bytes;
      frameBuffer += text;
      drainFrames(false);
      emit(false);
    },
    finish: (text = "") => {
      frameBuffer += text;
      drainFrames(true);
      emit(true);
    },
  };
}

export function generate(
  opts: GenerateOpts,
  client: HttpClient.HttpClient
): Effect<ModelOutput, ModelError> {
  const { model, messages, genConfig } = opts;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": BENCH_HARNESS_APP_REFERRER,
    "X-OpenRouter-Title": BENCH_HARNESS_APP_TITLE,
    [RESPONSE_CACHE_HEADER]: "true",
    [RESPONSE_CACHE_TTL_HEADER]: `${RESPONSE_CACHE_TTL_SECONDS}`,
  };
  if (opts.baseUrl === OPENROUTER_BASE_URL) {
    headers["X-OpenRouter-Metadata"] = "enabled";
  }
  if (genConfig.endpointId !== undefined) {
    headers["X-OR-Endpoint-Id"] = genConfig.endpointId;
  }
  if (genConfig.cloudflareVersion !== undefined) {
    headers["Cloudflare-Workers-Version-Overrides"] =
      genConfig.cloudflareVersion;
  }
  if (opts.sessionId !== undefined) {
    headers["x-session-id"] = opts.sessionId;
  }
  const sendSort =
    genConfig.sort !== undefined && genConfig.endpointId === undefined;
  const providerPreferences = {
    ...(sendSort && { sort: genConfig.sort }),
    ...(genConfig.providerOnly !== undefined && {
      only: [...genConfig.providerOnly],
    }),
    ...(genConfig.providerIgnore !== undefined && {
      ignore: [...genConfig.providerIgnore],
    }),
    ...(genConfig.allowFallbacks !== undefined && {
      allow_fallbacks: genConfig.allowFallbacks,
    }),
  };
  const sendProvider = Object.keys(providerPreferences).length > 0;
  const hasTimeout =
    genConfig.timeoutMs !== undefined && genConfig.timeoutMs > 0;
  const hasCompletionTimeout =
    genConfig.completionTimeoutMs !== undefined &&
    genConfig.completionTimeoutMs > 0;
  const baseModel = stripVariantSuffix(model);
  const autoRouterPlugin = buildAutoRouterPlugin(baseModel, genConfig);
  const wireAutoRouterPlugin =
    autoRouterPlugin === undefined
      ? undefined
      : toWireAutoRouterPlugin(autoRouterPlugin);
  const url = `${opts.baseUrl}/chat/completions`;
  let requestAttempt = 1;
  let attemptStartedAt = performance.now();
  let attemptStartedAtIso = new Date().toISOString();
  let requestId = crypto.randomUUID();
  let responseBody: string | undefined;
  let responseStatus: number | undefined;
  let responseIdentifiers: ModelErrorIdentifiers = {};
  const requestAttemptEffect = gen(function* () {
    const startedAt = performance.now();
    attemptStartedAt = startedAt;
    attemptStartedAtIso = new Date().toISOString();
    requestId = crypto.randomUUID();
    responseBody = undefined;
    responseStatus = undefined;
    responseIdentifiers = {};
    const epoch = yield* getCurrentEpoch;
    const retryAttempt = yield* getCurrentRetryAttempt;
    requestAttempt = (retryAttempt ?? 0) + 1;
    const runAttempt = yield* getCurrentRunAttempt;
    const callSalt = yield* getCurrentCallSalt;
    const cacheSalt = buildResponseCacheSalt(
      opts.sessionId,
      epoch,
      retryAttempt,
      callSalt
    );
    const body = {
      model,
      messages: messages.map(toApiMessage),
      stream: true,
      stream_options: { include_usage: true },
      cache_control: { type: "ephemeral" },
      ...(genConfig.temperature !== undefined && {
        temperature: genConfig.temperature,
      }),
      ...(genConfig.maxTokens !== undefined && {
        max_tokens: genConfig.maxTokens,
      }),
      ...(genConfig.tools !== undefined &&
        genConfig.tools.length > 0 && { tools: [...genConfig.tools] }),
      ...(genConfig.reasoningEffort !== undefined && {
        reasoning_effort: genConfig.reasoningEffort,
      }),
      ...(sendProvider && { provider: providerPreferences }),
      ...(wireAutoRouterPlugin !== undefined && {
        plugins: [wireAutoRouterPlugin],
      }),
      ...genConfig.extraBody,
    };
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeaders({
        ...headers,
        ...(cacheSalt !== undefined && {
          [RESPONSE_CACHE_SALT_HEADER]: cacheSalt,
        }),
      }),
      HttpClientRequest.bodyUnsafeJson(body)
    );
    logModelRequestStarted({
      requestId,
      sessionId: opts.sessionId,
      attempt: requestAttempt,
      model,
      url,
      startedAt: attemptStartedAtIso,
      request: requestSummary(messages.length, genConfig),
      requestBody: requestBodyForLog(body),
    });
    const response = yield* hasTimeout
      ? client.execute(request).pipe(
          timeout(millis(genConfig.timeoutMs!)),
          catchTag("TimeoutException", () =>
            fail(
              new ModelError({
                status: 408,
                message: `Request timed out after ${genConfig.timeoutMs}ms`,
              })
            )
          )
        )
      : client.execute(request);
    responseStatus = response.status;
    const identifiers = modelErrorIdentifiersFromHeaders(response.headers);
    responseIdentifiers = identifiers;
    const retryAfterHeader = response.headers["retry-after"] ?? null;
    if (response.status < 200 || response.status >= 300) {
      const text = yield* response.text;
      responseBody = text;
      return yield* fail(
        new ModelError({
          status: response.status,
          message: appendModelErrorIdentifiers(
            `OpenRouter HTTP ${response.status}: ${text}`,
            identifiers
          ),
          ...identifiers,
          ...(response.status === 429 && {
            retryAfterMs: parseRetryAfter(retryAfterHeader),
          }),
        })
      );
    }
    const decoder = new TextDecoder();
    const rawBodyParts: string[] = [];
    const liveResponseTracker = makeLiveResponseTracker({
      requestId,
      sessionId: opts.sessionId,
      attempt: requestAttempt,
      model,
      url,
      startedAt: attemptStartedAtIso,
      startedAtMs: startedAt,
      status: response.status,
    });
    yield* runForEach(response.stream, (chunk) =>
      sync(() => {
        const text = decoder.decode(chunk, { stream: true });
        rawBodyParts.push(text);
        liveResponseTracker.accept(text, chunk.byteLength);
      })
    ).pipe(
      ensuring(
        sync(() => {
          const trailingText = decoder.decode();
          rawBodyParts.push(trailingText);
          liveResponseTracker.finish(trailingText);
          responseBody = rawBodyParts.join("");
        })
      )
    );
    const rawBody = rawBodyParts.join("");
    responseBody = rawBody;
    const json = yield* decodeChatCompletionBody(rawBody, identifiers);
    const envelopeError = errorEnvelopeError(
      json,
      identifiers,
      retryAfterHeader
    );
    if (envelopeError) {
      logUnusableBody(rawBody, envelopeError, identifiers);
      return yield* fail(envelopeError);
    }
    const isCacheHit =
      response.headers[RESPONSE_CACHE_STATUS_HEADER] ===
      RESPONSE_CACHE_STATUS_HIT;
    const cacheSourceId = response.headers[RESPONSE_CACHE_SOURCE_ID_HEADER];
    logUnexpectedResponseCacheMiss({
      isCacheHit,
      runAttempt,
      retryAttempt,
      cacheSalt,
      model,
      ...(response.headers[RESPONSE_CACHE_STATUS_HEADER] !== undefined && {
        cacheStatus: response.headers[RESPONSE_CACHE_STATUS_HEADER],
      }),
      ...identifiers,
    });
    const output = yield* decodeResult(
      json,
      startedAt,
      identifiers,
      isCacheHit,
      cacheSourceId
    ).pipe(
      tapError((error) =>
        sync(() => {
          logUnusableBody(rawBody, error, identifiers);
        })
      )
    );
    const providerName = openRouterProviderName(json);
    logModelRequestCompleted({
      requestId,
      sessionId: opts.sessionId,
      attempt: requestAttempt,
      model,
      url,
      startedAt: attemptStartedAtIso,
      finishedAt: new Date().toISOString(),
      durationMs: performance.now() - startedAt,
      status: response.status,
      ok: true,
      ...(output.usage !== undefined && { usage: { ...output.usage } }),
      responseContent: output.completion,
      ...(output.message.reasoning !== undefined && {
        reasoning: output.message.reasoning,
      }),
      ...(output.message.reasoningDetails !== undefined && {
        reasoningDetails: output.message.reasoningDetails,
      }),
      ...(output.message.toolCalls !== undefined && {
        toolCalls: output.message.toolCalls,
      }),
      ...(providerName !== undefined && { providerName }),
      ...identifiers,
    });
    return output;
  });
  const attempt = (
    hasCompletionTimeout
      ? requestAttemptEffect.pipe(
          timeout(millis(genConfig.completionTimeoutMs!)),
          catchTag("TimeoutException", () =>
            fail(
              new ModelError({
                status: 408,
                message: `Request did not complete within ${genConfig.completionTimeoutMs}ms`,
              })
            )
          )
        )
      : requestAttemptEffect
  ).pipe(
    mapError(toModelError),
    tapError((error) =>
      sync(() => {
        logModelRequestCompleted({
          requestId,
          sessionId: opts.sessionId,
          attempt: requestAttempt,
          model,
          url,
          startedAt: attemptStartedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: performance.now() - attemptStartedAt,
          status: responseStatus ?? error.status,
          ok: false,
          response: responseBody,
          error: error.message,
          failureStage: requestFailureStage(responseStatus),
          ...responseIdentifiers,
        });
      })
    )
  );
  return retrySalted(attempt, rateLimitRetrySchedule(opts.retry ?? {}));
}

type ResponseIdentifiers = Pick<ModelErrorIdentifiers, "cfRay" | "xRequestId">;

function requestFailureStage(
  responseStatus: number | undefined
): "transport" | "http" | "response_processing" {
  if (responseStatus === undefined) {
    return "transport";
  }
  return responseStatus >= 200 && responseStatus < 300
    ? "response_processing"
    : "http";
}

interface StreamToolCallAccumulator {
  id?: string;
  type?: string;
  function: { name?: string; arguments: string };
}

function looksLikeSse(rawBody: string): boolean {
  return /^data:/mu.test(rawBody);
}

function parseJsonBody(
  rawBody: string,
  identifiers: ResponseIdentifiers
): Effect<unknown, ModelError> {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return succeed(parsed);
  } catch (cause) {
    const error = new ModelError({
      message: appendModelErrorIdentifiers(
        `OpenRouter 2xx body was not JSON: ${unknownErrorToString(cause)}`,
        identifiers
      ),
      ...identifiers,
    });
    logUnusableBody(rawBody, error, identifiers);
    return fail(error);
  }
}

function mergeStreamToolCallDelta(
  toolCalls: StreamToolCallAccumulator[],
  delta: Record<string, unknown>
): void {
  const deltaCalls = delta["tool_calls"];
  if (!Array.isArray(deltaCalls)) {
    return;
  }
  for (const rawCall of deltaCalls) {
    if (!isRecord(rawCall)) {
      continue;
    }
    const index = typeof rawCall["index"] === "number" ? rawCall["index"] : 0;
    const existing = (toolCalls[index] ??= { function: { arguments: "" } });
    if (typeof rawCall["id"] === "string") {
      existing.id = rawCall["id"];
    }
    if (typeof rawCall["type"] === "string") {
      existing.type = rawCall["type"];
    }
    const fn = rawCall["function"];
    if (isRecord(fn)) {
      if (typeof fn["name"] === "string") {
        existing.function.name = fn["name"];
      }
      if (typeof fn["arguments"] === "string") {
        existing.function.arguments += fn["arguments"];
      }
    }
  }
}

function parseSseFrame(frame: string): unknown {
  const data = frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (data.length === 0 || data === "[DONE]") {
    return undefined;
  }
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function reconstructFromSse(rawBody: string): Record<string, unknown> {
  let id: string | undefined;
  let model: string | undefined;
  let created: number | undefined;
  let systemFingerprint: string | null = null;
  let content = "";
  let reasoning = "";
  let reasoningDetails: unknown;
  let finishReason: string | null = null;
  let usage: unknown;
  let openRouterMetadata: unknown;
  let streamedError: unknown;
  let sawChoices = false;
  const toolCalls: StreamToolCallAccumulator[] = [];

  for (const frame of rawBody.split(/\r?\n\r?\n/)) {
    const parsed = parseSseFrame(frame);
    if (!isRecord(parsed)) {
      continue;
    }
    if (parsed["error"] !== undefined) {
      streamedError = parsed["error"];
    }
    if (typeof parsed["id"] === "string") {
      id = parsed["id"];
    }
    if (typeof parsed["model"] === "string") {
      model = parsed["model"];
    }
    if (typeof parsed["created"] === "number") {
      created = parsed["created"];
    }
    if (typeof parsed["system_fingerprint"] === "string") {
      systemFingerprint = parsed["system_fingerprint"];
    }
    if (parsed["usage"] !== undefined) {
      usage = parsed["usage"];
    }
    if (parsed["openrouter_metadata"] !== undefined) {
      openRouterMetadata = parsed["openrouter_metadata"];
    }
    const choices = parsed["choices"];
    if (!Array.isArray(choices)) {
      continue;
    }
    sawChoices = true;
    for (const choice of choices) {
      if (!isRecord(choice)) {
        continue;
      }
      if (choice["usage"] !== undefined) {
        usage = choice["usage"];
      }
      if (typeof choice["finish_reason"] === "string") {
        finishReason = choice["finish_reason"];
      }
      const source = isRecord(choice["delta"])
        ? choice["delta"]
        : choice["message"];
      if (!isRecord(source)) {
        continue;
      }
      if (typeof source["content"] === "string") {
        content += source["content"];
      }
      if (typeof source["reasoning"] === "string") {
        reasoning += source["reasoning"];
      } else if (typeof source["reasoning_content"] === "string") {
        reasoning += source["reasoning_content"];
      }
      if (source["reasoning_details"] !== undefined) {
        reasoningDetails = source["reasoning_details"];
      }
      mergeStreamToolCallDelta(toolCalls, source);
    }
  }

  const message: Record<string, unknown> = { role: "assistant", content };
  if (reasoning.length > 0) {
    message["reasoning"] = reasoning;
  }
  if (reasoningDetails !== undefined) {
    message["reasoning_details"] = reasoningDetails;
  }
  if (toolCalls.length > 0) {
    message["tool_calls"] = toolCalls.map((call) => ({
      id: call.id,
      type: call.type ?? "function",
      function: {
        name: call.function.name,
        arguments: call.function.arguments,
      },
    }));
  }

  return {
    id: id ?? "",
    model: model ?? "",
    object: "chat.completion",
    created: created ?? Math.floor(Date.now() / 1000),
    system_fingerprint: systemFingerprint,
    choices: sawChoices
      ? [{ index: 0, message, finish_reason: finishReason }]
      : null,
    ...(usage !== undefined && { usage }),
    ...(openRouterMetadata !== undefined && {
      openrouter_metadata: openRouterMetadata,
    }),
    ...(streamedError !== undefined && { error: streamedError }),
  };
}

function openRouterProviderName(json: unknown): string | undefined {
  if (!isRecord(json) || !isRecord(json["openrouter_metadata"])) {
    return undefined;
  }
  const metadata = json["openrouter_metadata"];
  const legacyProviderName = metadata["provider_name"] ?? metadata["provider"];
  if (typeof legacyProviderName === "string") {
    return legacyProviderName;
  }
  const attempts = metadata["attempts"];
  if (!Array.isArray(attempts)) {
    return undefined;
  }
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (isRecord(attempt) && typeof attempt["provider"] === "string") {
      return attempt["provider"];
    }
  }
  return undefined;
}

function decodeChatCompletionBody(
  rawBody: string,
  identifiers: ResponseIdentifiers
): Effect<unknown, ModelError> {
  return looksLikeSse(rawBody)
    ? succeed(reconstructFromSse(rawBody))
    : parseJsonBody(rawBody, identifiers);
}

const RAW_BODY_LOG_LIMIT = 2000;

const errorEnvelopeSchema = z.object({
  choices: z.array(z.unknown()).nullish(),
  error: z.object({
    message: z.string().optional(),
    code: z.union([z.number(), z.string()]).optional(),
  }),
});

function errorEnvelopeError(
  json: unknown,
  identifiers: ResponseIdentifiers,
  retryAfterHeader: string | null
): ModelError | undefined {
  const parsed = parseSchema(errorEnvelopeSchema, json);
  if (Either.isLeft(parsed)) {
    return undefined;
  }
  const { choices } = parsed.right;
  if (isDefinedAndNotNull(choices) && choices.length > 0) {
    return undefined;
  }
  const { code, message } = parsed.right.error;
  const status = toStatus(code);
  const details = [
    code === undefined ? undefined : `code ${code}`,
    message,
  ].filter((detail): detail is string => detail !== undefined);
  return new ModelError({
    ...(status !== undefined && { status }),
    message: appendModelErrorIdentifiers(
      details.length > 0
        ? `OpenRouter HTTP 200 error envelope (${details.join(": ")})`
        : "OpenRouter HTTP 200 error envelope",
      identifiers
    ),
    ...identifiers,
    ...(status === 429 && { retryAfterMs: parseRetryAfter(retryAfterHeader) }),
  });
}

function toStatus(code: number | string | undefined): number | undefined {
  if (code === undefined) {
    return undefined;
  }
  const parsed = typeof code === "number" ? code : Number(code);
  const isHttpStatus =
    Number.isInteger(parsed) && parsed >= 100 && parsed <= 599;
  return isHttpStatus ? parsed : undefined;
}

function logUnusableBody(
  rawBody: string,
  error: ModelError,
  identifiers: ResponseIdentifiers
): void {
  wLog("OpenRouter 2xx response did not yield a completion", {
    error_message: error.message,
    ...(error.status !== undefined && { error_status: error.status }),
    raw_body:
      rawBody.length > RAW_BODY_LOG_LIMIT
        ? `${rawBody.slice(0, RAW_BODY_LOG_LIMIT - 3)}...`
        : rawBody,
    ...(identifiers.cfRay !== undefined && { cf_ray: identifiers.cfRay }),
    ...(identifiers.xRequestId !== undefined && {
      x_request_id: identifiers.xRequestId,
    }),
  });
}

function toApiContentItem(part: ContentPart) {
  switch (part.type) {
    case "text": {
      return { type: "text", text: part.text };
    }
    case "image_url": {
      return {
        type: "image_url",
        image_url: {
          url: part.imageUrl.url,
          ...(part.imageUrl.detail !== undefined && {
            detail: part.imageUrl.detail,
          }),
        },
      };
    }
    case "video_url": {
      return {
        type: "video_url",
        video_url: {
          url: part.videoUrl.url,
        },
      };
    }
    default: {
      return part satisfies never;
    }
  }
}

function toApiMessage(message: ChatMessage) {
  switch (message.role) {
    case MessageRole.System: {
      return { role: "system", content: message.content };
    }
    case MessageRole.User: {
      if (message.contentParts && message.contentParts.length > 0) {
        return {
          role: "user",
          content: message.contentParts.map(toApiContentItem),
        };
      }
      return { role: "user", content: message.content };
    }
    case MessageRole.Assistant: {
      const base: {
        role: "assistant";
        content: string;
        tool_calls?: unknown[];
        reasoning_details?: ReasoningDetails;
        model?: string;
      } = {
        role: "assistant",
        content: message.content,
      };
      if (message.model !== undefined) {
        base.model = message.model;
      }
      if (hasReasoningDetails(message.reasoningDetails)) {
        base.reasoning_details = message.reasoningDetails;
      }
      if (message.toolCalls && message.toolCalls.length > 0) {
        return { ...base, tool_calls: [...message.toolCalls] };
      }
      return base;
    }
    case MessageRole.Tool: {
      return {
        role: "tool",
        content: message.content,
        tool_call_id: message.toolCallId ?? "",
      };
    }
    default: {
      return message.role satisfies never;
    }
  }
}

function decodeResult(
  raw: unknown,
  startedAt: number,
  identifiers: ResponseIdentifiers,
  isCacheHit: boolean,
  cacheSourceId?: string
): Effect<ModelOutput, ModelError> {
  const parseResult = parseSchema(
    ChatResult$inboundSchema,
    normalizeResultForSchema(raw)
  );
  if (Either.isLeft(parseResult)) {
    return fail(
      new ModelError({
        message: appendModelErrorIdentifiers(
          `OpenRouter response failed validation: ${parseResult.left.message}`,
          identifiers
        ),
        ...identifiers,
      })
    );
  }
  const result = parseResult.right;
  const responseIdentifiers: ModelErrorIdentifiers = {
    ...identifiers,
    ...(result.id !== undefined && { generationId: result.id }),
  };
  const choice = result.choices[0];
  if (!choice) {
    return fail(
      new ModelError({
        message: appendModelErrorIdentifiers(
          "OpenRouter response had no choices",
          responseIdentifiers
        ),
        ...responseIdentifiers,
      })
    );
  }
  const rawContent = choice.message.content;
  const completion = typeof rawContent === "string" ? rawContent : "";
  const reasoning = choice.message.reasoning ?? undefined;
  const reasoningDetails = extractReasoningDetails(raw);
  const usage = toModelUsage(result.usage);
  const toolCalls = choice.message.toolCalls ?? [];
  const hasSourceId = isCacheHit && cacheSourceId !== undefined;
  return recordGenerationId(
    hasSourceId ? cacheSourceId : result.id,
    isCacheHit,
    hasSourceId
  ).pipe(
    flatMap(() =>
      succeed({
        completion,
        message: {
          role: MessageRole.Assistant,
          content: completion,
          ...(toolCalls.length > 0 && { toolCalls }),
          ...(reasoning !== undefined && { reasoning }),
          ...(reasoningDetails !== undefined && { reasoningDetails }),
          ...(result.model !== undefined && { model: result.model }),
        },
        generationTimeMs: Math.round(performance.now() - startedAt),
        ...(usage && { usage }),
        ...(isRecord(raw) && { rawResponse: raw }),
      })
    )
  );
}

function normalizeResultForSchema(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }
  return {
    ...raw,
    ...(!("system_fingerprint" in raw) && { system_fingerprint: null }),
    ...(!("created" in raw) && { created: 0 }),
    ...(!("object" in raw) && { object: "chat.completion" }),
  };
}

function extractReasoningDetails(raw: unknown): ReasoningDetails | undefined {
  if (!isRecord(raw) || !Array.isArray(raw["choices"])) {
    return undefined;
  }
  const choice = raw["choices"][0];
  if (!isRecord(choice) || !isRecord(choice["message"])) {
    return undefined;
  }
  const details = choice["message"]["reasoning_details"];
  return hasReasoningDetails(details) ? details : undefined;
}

function toModelUsage(usage: ChatUsage | undefined): ModelUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const reasoningTokens = usage.completionTokensDetails?.reasoningTokens;
  return {
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    ...(isDefinedAndNotNull(reasoningTokens) && { reasoningTokens }),
    ...(isDefinedAndNotNull(usage.cost) && { totalCost: usage.cost }),
  };
}

function toModelError(cause: unknown): ModelError {
  if (cause instanceof ModelError) {
    return cause;
  }
  return new ModelError({
    message: `OpenRouter request failed: ${String(cause)}`,
  });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1e3 : undefined;
}
