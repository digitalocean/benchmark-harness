import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { wLog } from "./log";

const DEFAULT_LOG_PATH = "logs/requests.jsonl";

interface RequestIdentity {
  readonly requestId: string;
  readonly sessionId?: string | undefined;
  readonly attempt: number;
  readonly model: string;
  readonly url: string;
}

export interface ModelRequestStartedEntry extends RequestIdentity {
  readonly startedAt: string;
  readonly request: Readonly<Record<string, unknown>>;
  readonly requestBody?: Readonly<Record<string, unknown>> | undefined;
}

export interface ModelRequestProgressEntry extends RequestIdentity {
  readonly startedAt: string;
  readonly observedAt: string;
  readonly elapsedMs: number;
  readonly status: number;
  readonly receivedBytes: number;
  readonly timeToFirstOutputMs?: number | undefined;
  readonly contentDelta?: string | undefined;
  readonly reasoningDelta?: string | undefined;
  readonly reasoningDetails?: unknown;
  readonly toolCallDeltas?: readonly unknown[] | undefined;
}

export interface ModelRequestCompletedEntry extends RequestIdentity {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly status?: number | undefined;
  readonly ok: boolean;
  readonly usage?: Readonly<Record<string, unknown>> | undefined;
  readonly response?: string | undefined;
  readonly responseContent?: string | undefined;
  readonly reasoning?: string | undefined;
  readonly reasoningDetails?: unknown;
  readonly toolCalls?: readonly unknown[] | undefined;
  readonly error?: string | undefined;
  readonly failureStage?:
    | "transport"
    | "http"
    | "response_processing"
    | undefined;
  readonly providerName?: string | undefined;
  readonly generationId?: string | undefined;
  readonly xRequestId?: string | undefined;
  readonly cfRay?: string | undefined;
}

let ensuredDirectory: string | undefined;
let writesDisabled = false;

function logFilePath(): string | null {
  if (process.env.REQUEST_LOG === "0" || writesDisabled) {
    return null;
  }
  const configured = process.env.REQUEST_LOG_FILE;
  return configured !== undefined && configured.length > 0
    ? configured
    : DEFAULT_LOG_PATH;
}

function appendRecord(record: Readonly<Record<string, unknown>>): void {
  const path = logFilePath();
  if (path === null) {
    return;
  }
  try {
    const directory = dirname(path);
    if (ensuredDirectory !== directory) {
      mkdirSync(directory, { recursive: true });
      ensuredDirectory = directory;
    }
    appendFileSync(path, `${JSON.stringify(record)}\n`);
  } catch (error) {
    writesDisabled = true;
    wLog("Request event log write failed; disabling request event file", {
      path,
      error: String(error),
    });
  }
}

export function logModelRequestStarted(entry: ModelRequestStartedEntry): void {
  appendRecord({
    event: "started",
    request_id: entry.requestId,
    session_id: entry.sessionId ?? null,
    attempt: entry.attempt,
    model: entry.model,
    url: entry.url,
    started_at: entry.startedAt,
    request: entry.request,
    ...(entry.requestBody !== undefined && { request_body: entry.requestBody }),
  });
}

export function logModelRequestProgress(
  entry: ModelRequestProgressEntry
): void {
  appendRecord({
    event: "progress",
    request_id: entry.requestId,
    session_id: entry.sessionId ?? null,
    attempt: entry.attempt,
    model: entry.model,
    url: entry.url,
    started_at: entry.startedAt,
    observed_at: entry.observedAt,
    elapsed_ms: Math.round(entry.elapsedMs),
    status: entry.status,
    received_bytes: entry.receivedBytes,
    ...(entry.timeToFirstOutputMs !== undefined && {
      time_to_first_output_ms: Math.round(entry.timeToFirstOutputMs),
    }),
    ...(entry.contentDelta !== undefined &&
      entry.contentDelta.length > 0 && {
        content_delta: entry.contentDelta,
      }),
    ...(entry.reasoningDelta !== undefined &&
      entry.reasoningDelta.length > 0 && {
        reasoning_delta: entry.reasoningDelta,
      }),
    ...(entry.reasoningDetails !== undefined && {
      reasoning_details: entry.reasoningDetails,
    }),
    ...(entry.toolCallDeltas !== undefined &&
      entry.toolCallDeltas.length > 0 && {
        tool_call_deltas: entry.toolCallDeltas,
      }),
  });
}

export function logModelRequestCompleted(
  entry: ModelRequestCompletedEntry
): void {
  const status = entry.status ?? null;
  appendRecord({
    event: "completed",
    request_id: entry.requestId,
    session_id: entry.sessionId ?? null,
    attempt: entry.attempt,
    model: entry.model,
    url: entry.url,
    started_at: entry.startedAt,
    finished_at: entry.finishedAt,
    duration_ms: Math.round(entry.durationMs),
    status,
    ok: entry.ok,
    ...(entry.usage !== undefined && { usage: entry.usage }),
    ...(entry.providerName !== undefined && {
      provider_name: entry.providerName,
    }),
    ...(entry.generationId !== undefined && {
      generation_id: entry.generationId,
    }),
    ...(entry.xRequestId !== undefined && { x_request_id: entry.xRequestId }),
    ...(entry.cfRay !== undefined && { cf_ray: entry.cfRay }),
    ...(entry.error !== undefined && { error: entry.error }),
    ...(entry.responseContent !== undefined && {
      response_content: entry.responseContent,
    }),
    ...(entry.reasoning !== undefined && { reasoning: entry.reasoning }),
    ...(entry.reasoningDetails !== undefined && {
      reasoning_details: entry.reasoningDetails,
    }),
    ...(entry.toolCalls !== undefined && { tool_calls: entry.toolCalls }),
    ...(entry.failureStage !== undefined && {
      failure_stage: entry.failureStage,
    }),
    ...(entry.response !== undefined &&
      status !== 200 &&
      status !== 201 && { response: entry.response }),
  });
}
