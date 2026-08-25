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
}

export interface ModelRequestCompletedEntry extends RequestIdentity {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly status?: number | undefined;
  readonly ok: boolean;
  readonly usage?: Readonly<Record<string, unknown>> | undefined;
  readonly response?: string | undefined;
  readonly error?: string | undefined;
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
    ...(entry.response !== undefined &&
      status !== 200 &&
      status !== 201 && { response: entry.response }),
  });
}
