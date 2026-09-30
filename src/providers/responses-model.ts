import { randomUUID } from "node:crypto";

import type {
  EasyInputMessage,
  InputsUnion,
  ResponsesRequest,
  StreamEvents,
} from "@openrouter/sdk/models";
import { camelCase, snakeCase } from "change-case";
import { Tag } from "effect/Context";
import { millis } from "effect/Duration";
import type { Effect } from "effect/Effect";
import {
  catchTag,
  fail,
  gen,
  mapError,
  sync,
  tapError,
  timeout,
} from "effect/Effect";
import type { Layer } from "effect/Layer";
import { effect, provide } from "effect/Layer";

import type { ModelUsage } from "../harness/core";
import { ModelError } from "../harness/core";
import type { GenerateConfig } from "../harness/model";
import { stripVariantSuffix } from "../harness/model";
import { definedValues, isRecord } from "../internal/guards";
import {
  logModelRequestCompleted,
  logModelRequestProgress,
  logModelRequestStarted,
} from "../internal/request-log";
import { getCurrentRetryAttempt } from "../runtime/response-cache";
import type { RetryConfig } from "../runtime/retry";
import { rateLimitRetrySchedule, retrySalted } from "../runtime/retry";
import { buildAutoRouterPlugin } from "./auto-router-plugin";
import type { ModelErrorIdentifiers } from "./request-identifiers";
import { appendModelErrorIdentifiers } from "./request-identifiers";
import type { ResponsesResult, ResponsesService } from "./responses-client";
import {
  extractMessageText,
  makeResponsesLayer,
  Responses,
  toModelError,
  unwrapStreamEvent,
  usageFromResponses,
} from "./responses-client";

export type ResponsesInputItem = Record<string, unknown>;

export type ResponsesMessageRole =
  | "user"
  | "assistant"
  | "system"
  | "developer";

export function responsesMessage(
  role: ResponsesMessageRole,
  content: string
): EasyInputMessage {
  return { type: "message", role, content };
}

export interface ResponsesFunctionTool {
  readonly type: "function";
  readonly name: string;
  readonly description?: string;
  readonly parameters: Record<string, unknown>;
  readonly strict?: boolean | null;
}

export interface ResponsesGenerateConfig extends Omit<GenerateConfig, "tools"> {
  readonly model?: string;
  readonly instructions?: string;
  readonly tools?: readonly ResponsesFunctionTool[];
}

export interface ResponsesTurn {
  readonly outputItems: Record<string, unknown>[];
  readonly functionCalls: readonly {
    readonly callId: string;
    readonly name: string;
    readonly arguments: string;
  }[];
  readonly text: string;
  readonly usage?: ModelUsage;
  readonly generationTimeMs: number;
}

export interface ResponsesModelConfig {
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly sessionId?: string;
  readonly retry?: RetryConfig;
  readonly traceHeaders?: Readonly<Record<string, string>>;
}

export interface ResponsesModelService {
  readonly generate: (
    input: readonly ResponsesInputItem[],
    config: ResponsesGenerateConfig,
    options?: {
      readonly onStreamEvent?: (event: Record<string, unknown>) => void;
    }
  ) => Effect<ResponsesTurn, ModelError>;
}

export class ResponsesModel extends Tag(
  "@openrouter/bench-harness/responses-model/ResponsesModel"
)<ResponsesModel, ResponsesModelService>() {}

export function makeResponsesModelLayer(
  config: ResponsesModelConfig
): Layer<ResponsesModel> {
  const baseUrl = config.baseUrl ?? "https://openrouter.ai/api/v1";
  const responsesLayer = makeResponsesLayer(
    definedValues({
      apiKey: config.apiKey,
      baseUrl,
      sessionId: config.sessionId,
      traceHeaders: config.traceHeaders,
    })
  );
  return effect(ResponsesModel)(
    gen(function* () {
      const responses = yield* Responses;
      return ResponsesModel.of({
        generate: (input, generateConfig, options) =>
          generate(
            {
              model: config.model,
              input,
              genConfig: generateConfig,
              retry: config.retry,
              baseUrl,
              sessionId: config.sessionId,
              onStreamEvent: options?.onStreamEvent,
            },
            responses
          ),
      });
    })
  ).pipe(provide(responsesLayer));
}

export interface ResponsesGenerateOpts {
  readonly model: string;
  readonly input: readonly ResponsesInputItem[];
  readonly genConfig: ResponsesGenerateConfig;
  readonly retry?: RetryConfig;
  readonly baseUrl?: string;
  readonly sessionId?: string;
  readonly onStreamEvent?: (event: Record<string, unknown>) => void;
}

export function generate(
  opts: ResponsesGenerateOpts,
  responses: ResponsesService
): Effect<ResponsesTurn, ModelError> {
  const { genConfig } = opts;
  const sendSort =
    genConfig.sort !== undefined && genConfig.endpointId === undefined;
  const providerPreferences = definedValues({
    sort: sendSort ? genConfig.sort : undefined,
    only:
      genConfig.providerOnly !== undefined
        ? [...genConfig.providerOnly]
        : undefined,
    ignore:
      genConfig.providerIgnore !== undefined
        ? [...genConfig.providerIgnore]
        : undefined,
    allowFallbacks: genConfig.allowFallbacks,
  });
  const sendProvider = Object.keys(providerPreferences).length > 0;
  const requestModel = genConfig.model ?? opts.model;
  const baseModel = stripVariantSuffix(requestModel);
  const autoRouterPlugin = buildAutoRouterPlugin(baseModel, genConfig);
  const body = {
    model: requestModel,
    input: toSdkInput(opts.input),
    store: false,
    include: ["reasoning.encrypted_content"],
    ...definedValues({
      instructions: genConfig.instructions,
      temperature: genConfig.temperature,
      maxOutputTokens: genConfig.maxTokens,
      tools:
        genConfig.tools !== undefined && genConfig.tools.length > 0
          ? [...genConfig.tools]
          : undefined,
    }),
    reasoning: { effort: genConfig.reasoningEffort },
    ...definedValues({
      provider: sendProvider ? providerPreferences : undefined,
    }),
    ...definedValues({
      plugins: autoRouterPlugin !== undefined ? [autoRouterPlugin] : undefined,
    }),
  } satisfies ResponsesRequest;
  const extraHeaders = definedValues({
    "X-OR-Endpoint-Id": genConfig.endpointId,
    "Cloudflare-Workers-Version-Overrides": genConfig.cloudflareVersion,
  });
  const extraBody = genConfig.extraBody;
  let identifiers: ModelErrorIdentifiers = {};
  let requestAttempt = 1;
  let requestId = randomUUID();
  let attemptStartedAt = performance.now();
  let attemptStartedAtIso = new Date().toISOString();
  let sawStreamEvent = false;
  const url = `${(opts.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/responses`;
  const requestAttemptEffect = gen(function* () {
    identifiers = {};
    sawStreamEvent = false;
    requestId = randomUUID();
    attemptStartedAt = performance.now();
    attemptStartedAtIso = new Date().toISOString();
    requestAttempt = ((yield* getCurrentRetryAttempt) ?? 0) + 1;
    const progress = makeResponsesProgressTracker({
      requestId,
      sessionId: opts.sessionId,
      attempt: requestAttempt,
      model: requestModel,
      url,
      startedAt: attemptStartedAtIso,
      startedAtMs: attemptStartedAt,
    });
    logModelRequestStarted({
      requestId,
      sessionId: opts.sessionId,
      attempt: requestAttempt,
      model: requestModel,
      url,
      startedAt: attemptStartedAtIso,
      request: {
        inputItems: opts.input.length,
        tools: genConfig.tools?.length ?? 0,
        stream: true,
      },
      requestBody: responsesRequestBodyForLog(body, extraBody),
    });
    const result = yield* responses
      .send(body, {
        ...definedValues({
          timeoutMs: genConfig.timeoutMs,
        }),
        ...definedValues({
          extraHeaders:
            Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
        }),
        ...definedValues({
          extraBody,
        }),
        onResponseIdentifiers: (responseIdentifiers) => {
          identifiers = { ...identifiers, ...responseIdentifiers };
        },
        onStreamEvent: (event: StreamEvents) => {
          sawStreamEvent = true;
          const rawEvent = unwrapStreamEvent(event);
          if (isRecord(rawEvent)) {
            const response = rawEvent["response"];
            if (isRecord(response) && typeof response["id"] === "string") {
              identifiers = { ...identifiers, generationId: response["id"] };
            }
            progress.accept(rawEvent);
            opts.onStreamEvent?.(rawEvent);
          }
        },
      })
      .pipe(mapError(toModelError));
    progress.finish();
    const turn = toResponsesTurn(
      result,
      Math.round(performance.now() - attemptStartedAt)
    );
    logModelRequestCompleted({
      requestId,
      sessionId: opts.sessionId,
      attempt: requestAttempt,
      model: requestModel,
      url,
      startedAt: attemptStartedAtIso,
      finishedAt: new Date().toISOString(),
      durationMs: performance.now() - attemptStartedAt,
      status: 200,
      ok: true,
      ...(turn.usage !== undefined && { usage: { ...turn.usage } }),
      responseContent: turn.text,
      ...(turn.functionCalls.length > 0 && {
        toolCalls: turn.functionCalls,
      }),
      ...(result.provider !== null && { providerName: result.provider }),
      ...identifiers,
    });
    return turn;
  });
  const completionTimeoutMs = genConfig.completionTimeoutMs;
  const completionTimedAttempt =
    completionTimeoutMs !== undefined && completionTimeoutMs > 0
      ? requestAttemptEffect.pipe(
          timeout(millis(completionTimeoutMs)),
          catchTag("TimeoutException", () =>
            fail(
              new ModelError({
                status: 408,
                message: appendModelErrorIdentifiers(
                  `Request did not complete within ${completionTimeoutMs}ms`,
                  identifiers
                ),
                ...identifiers,
              })
            )
          )
        )
      : requestAttemptEffect;
  const loggedAttempt = completionTimedAttempt.pipe(
    tapError((error) =>
      sync(() => {
        logModelRequestCompleted({
          requestId,
          sessionId: opts.sessionId,
          attempt: requestAttempt,
          model: requestModel,
          url,
          startedAt: attemptStartedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: performance.now() - attemptStartedAt,
          status: error.status,
          ok: false,
          error: error.message,
          failureStage: responsesFailureStage(error, sawStreamEvent),
          ...identifiers,
        });
      })
    )
  );
  return retrySalted(loggedAttempt, rateLimitRetrySchedule(opts.retry ?? {}));
}

const RESPONSES_PROGRESS_INTERVAL_MS = 1000;
const RESPONSES_REQUEST_BODY_LOG_LIMIT = 256_000;

interface ResponsesProgressTrackerInput {
  readonly requestId: string;
  readonly sessionId?: string;
  readonly attempt: number;
  readonly model: string;
  readonly url: string;
  readonly startedAt: string;
  readonly startedAtMs: number;
}

function makeResponsesProgressTracker(input: ResponsesProgressTrackerInput): {
  readonly accept: (event: Readonly<Record<string, unknown>>) => void;
  readonly finish: () => void;
} {
  let receivedBytes = 0;
  let loggedBytes = 0;
  let lastEmittedAtMs = 0;
  let emitted = false;
  let timeToFirstOutputMs: number | undefined;
  let contentDelta = "";
  let reasoningDelta = "";
  let toolCallDeltas: Record<string, unknown>[] = [];

  const emit = (force: boolean) => {
    const now = performance.now();
    const hasOutput =
      contentDelta.length > 0 ||
      reasoningDelta.length > 0 ||
      toolCallDeltas.length > 0;
    if (
      (!force &&
        emitted &&
        now - lastEmittedAtMs < RESPONSES_PROGRESS_INTERVAL_MS) ||
      (force && emitted && !hasOutput && receivedBytes === loggedBytes)
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
      status: 200,
      receivedBytes,
      ...(timeToFirstOutputMs !== undefined && { timeToFirstOutputMs }),
      ...(contentDelta.length > 0 && { contentDelta }),
      ...(reasoningDelta.length > 0 && { reasoningDelta }),
      ...(toolCallDeltas.length > 0 && { toolCallDeltas }),
    });
    emitted = true;
    loggedBytes = receivedBytes;
    lastEmittedAtMs = now;
    contentDelta = "";
    reasoningDelta = "";
    toolCallDeltas = [];
  };

  return {
    accept: (event) => {
      const serialized = JSON.stringify(event);
      receivedBytes += Buffer.byteLength(serialized);
      const type = typeof event["type"] === "string" ? event["type"] : "";
      const delta = typeof event["delta"] === "string" ? event["delta"] : "";
      if (type.includes("output_text") && delta.length > 0) {
        contentDelta += delta;
      } else if (type.includes("reasoning") && delta.length > 0) {
        reasoningDelta += delta;
      } else if (type.includes("function_call_arguments")) {
        toolCallDeltas.push(event);
      }
      if (
        timeToFirstOutputMs === undefined &&
        (contentDelta.length > 0 ||
          reasoningDelta.length > 0 ||
          toolCallDeltas.length > 0)
      ) {
        timeToFirstOutputMs = performance.now() - input.startedAtMs;
      }
      emit(type === "response.completed" || type === "response.incomplete");
    },
    finish: () => emit(true),
  };
}

function responsesRequestBodyForLog(
  body: ResponsesRequest,
  extraBody: Readonly<Record<string, unknown>> | undefined
): Readonly<Record<string, unknown>> {
  const wireBody = toWireValue(body);
  const merged = {
    ...(isRecord(wireBody) ? wireBody : {}),
    ...extraBody,
    stream: true,
  };
  const bytes = Buffer.byteLength(JSON.stringify(merged));
  return bytes <= RESPONSES_REQUEST_BODY_LOG_LIMIT
    ? merged
    : {
        model: body.model,
        stream: true,
        input_items: Array.isArray(body.input) ? body.input.length : 0,
        request_body_truncated: true,
        request_body_bytes: bytes,
      };
}

function responsesFailureStage(
  error: ModelError,
  sawStreamEvent: boolean
): "transport" | "http" | "response_processing" {
  if (error.status !== undefined && error.status !== 408 && !sawStreamEvent) {
    return "http";
  }
  return sawStreamEvent ? "response_processing" : "transport";
}

const RAW_PAYLOAD_KEYS = new Set(["arguments", "output"]);

export function toSdkInput(input: readonly ResponsesInputItem[]): InputsUnion {
  return input.map(toSdkValue) as InputsUnion;
}

function toSdkValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toSdkValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nestedValue]) =>
      nestedValue === null
        ? []
        : [
            [
              camelCase(key),
              RAW_PAYLOAD_KEYS.has(key) ? nestedValue : toSdkValue(nestedValue),
            ],
          ]
    )
  );
}

function toWireRecord(
  record: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      snakeCase(key),
      RAW_PAYLOAD_KEYS.has(key) ? value : toWireValue(value),
    ])
  );
}

function toWireValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toWireValue);
  }
  return isRecord(value) ? toWireRecord(value) : value;
}

function toResponsesTurn(
  result: ResponsesResult,
  generationTimeMs: number
): ResponsesTurn {
  const outputItems = result.output.map(toWireRecord);
  const usage = usageFromResponses(result.usage);
  const functionCalls = outputItems.flatMap((item) => {
    const callId = item["call_id"];
    if (
      item["type"] !== "function_call" ||
      typeof callId !== "string" ||
      typeof item["name"] !== "string" ||
      typeof item["arguments"] !== "string"
    ) {
      return [];
    }
    return [
      {
        callId,
        name: item["name"],
        arguments: item["arguments"],
      },
    ];
  });
  return definedValues({
    outputItems,
    functionCalls,
    text: extractMessageText(outputItems),
    usage,
    generationTimeMs,
  });
}
