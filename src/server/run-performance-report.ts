import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { eLog, iLog, wLog } from "../internal/log";
import type { z } from "../internal/zod";
import { asyncBufferFromBytes, readResultRows } from "../results/parquet";
import { buildGpqaAnalytics } from "./gpqa-analytics";
import type { GpqaAnalytics } from "./gpqa-analytics";
import { buildGpqaReport } from "./gpqa-report";
import type { GpqaReport } from "./gpqa-report";
import {
  GpqaPerformanceSummarySchema,
  RUN_PERFORMANCE_REPORT_SCHEMA_VERSION,
} from "./run-performance-report-schema";
import type {
  RequestPerf,
  RunPerformanceReportPayload,
} from "./run-performance-report-schema";
import type {
  RunPerformanceReportStore,
  StoredRunPerformanceReport,
} from "./run-performance-report-store";
import type { RunInference, RunRecord, RunStatus } from "./run-registry";

export {
  GpqaAnalyticsSchema,
  GpqaPerformanceSummarySchema,
  RequestPerfSchema,
  RUN_PERFORMANCE_REPORT_SCHEMA_VERSION,
  RunPerformanceReportPayloadSchema,
} from "./run-performance-report-schema";
export type {
  RequestPerf,
  RunPerformanceReportPayload,
} from "./run-performance-report-schema";

export const PERFORMANCE_REPORT_RELATIVE_PATH =
  "reports/performance-report.json";
export const GPQA_REPORT_RELATIVE_PATH = "reports/gpqa-report.json";

export interface PrecomputedGpqaReportFile extends GpqaReport {
  readonly runId: string;
  readonly file: string;
  readonly inference: RunInference;
  readonly analytics: GpqaAnalytics;
}

interface RequestEntry {
  started?: Record<string, unknown>;
  completed?: Record<string, unknown>;
}

let performanceReportStore: RunPerformanceReportStore | undefined;

export function configureRunPerformanceReportStore(
  store: RunPerformanceReportStore
): void {
  performanceReportStore = store;
}

export async function getStoredRunPerformanceReport(
  runId: string
): Promise<StoredRunPerformanceReport | undefined> {
  if (performanceReportStore === undefined) {
    return undefined;
  }
  return performanceReportStore.get(runId);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function percentile(
  values: readonly number[],
  quantile: number
): number | null {
  if (values.length === 0) {
    return null;
  }
  const position = (values.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = values[lowerIndex]!;
  const upper = values[upperIndex]!;
  return lower + (upper - lower) * (position - lowerIndex);
}

function emptyRequestPerf(): RequestPerf {
  return {
    requestCount: 0,
    completedCount: 0,
    pendingCount: 0,
    successfulCount: 0,
    errorCount: 0,
    retryAttemptCount: 0,
    postProcessingFailureCount: 0,
    successRate: null,
    errorRate: null,
    retryAttemptRate: null,
    postProcessingFailureRate: null,
    latencyMs: {
      sampleSize: 0,
      p50: null,
      p75: null,
      p90: null,
      p95: null,
      mean: null,
      max: null,
    },
    observedWindowMs: null,
    peakInFlight: null,
    averageInFlight: null,
    throughputPerMinute: null,
    outputTokensTotal: 0,
    outputTokenDurationMs: 0,
    effectiveOutputTokensPerSecond: null,
    errorStatusCounts: [],
  };
}

export function parseRequestLogEntries(jsonl: string): readonly RequestEntry[] {
  const requests = new Map<string, RequestEntry>();
  for (const line of jsonl.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const requestId = String(event.request_id ?? "unknown");
    const current = requests.get(requestId) ?? {};
    if (event.event === "started") {
      current.started = event;
    } else if (event.event === "completed") {
      current.completed = event;
    }
    requests.set(requestId, current);
  }
  return [...requests.values()];
}

function isPostProcessingFailureEntry(
  completed: Record<string, unknown>
): boolean {
  if (completed.failure_stage === "response_processing") {
    return true;
  }
  if (
    completed.failure_stage !== undefined &&
    completed.failure_stage !== null
  ) {
    return false;
  }
  const status = Number(completed.status);
  return Number.isFinite(status) && status >= 200 && status < 300;
}

export function buildRequestPerf(
  entries: readonly RequestEntry[],
  freezeAtMs: number
): RequestPerf {
  const completedEntries = entries.filter((entry) => entry.completed);
  const pendingCount = entries.length - completedEntries.length;
  const successfulCount = completedEntries.filter(
    (entry) => entry.completed?.ok === true
  ).length;
  const errorEntries = completedEntries.filter(
    (entry) => entry.completed?.ok !== true
  );
  const postProcessingFailureCount = errorEntries.filter((entry) =>
    isPostProcessingFailureEntry(entry.completed!)
  ).length;
  const retryAttemptCount = entries.filter((entry) => {
    const attempt = Number(entry.started?.attempt ?? entry.completed?.attempt);
    return Number.isFinite(attempt) && attempt > 1;
  }).length;
  const completedDurationsMs = completedEntries
    .map((entry) => Number(entry.completed?.duration_ms))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const mean =
    completedDurationsMs.length === 0
      ? null
      : completedDurationsMs.reduce((sum, value) => sum + value, 0) /
        completedDurationsMs.length;
  const errorStatusCounts = new Map<string, number>();
  for (const entry of errorEntries) {
    const rawStatus = entry.completed?.status;
    const status =
      rawStatus === null || rawStatus === undefined
        ? "No status"
        : String(rawStatus);
    errorStatusCounts.set(status, (errorStatusCounts.get(status) ?? 0) + 1);
  }
  const concurrencyPoints: [number, number][] = [];
  let earliestStartedMs = Number.POSITIVE_INFINITY;
  let latestObservedMs = Number.NEGATIVE_INFINITY;
  let activeDurationMs = 0;
  for (const entry of entries) {
    const startedMs = new Date(
      String(entry.started?.started_at ?? entry.completed?.started_at ?? "")
    ).getTime();
    const finishedMs = entry.completed
      ? new Date(String(entry.completed.finished_at ?? "")).getTime()
      : freezeAtMs;
    if (
      !Number.isFinite(startedMs) ||
      !Number.isFinite(finishedMs) ||
      finishedMs < startedMs
    ) {
      continue;
    }
    earliestStartedMs = Math.min(earliestStartedMs, startedMs);
    latestObservedMs = Math.max(latestObservedMs, finishedMs);
    activeDurationMs += finishedMs - startedMs;
    concurrencyPoints.push([startedMs, 1], [finishedMs, -1]);
  }
  concurrencyPoints.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  let activeRequests = 0;
  let peakInFlight = 0;
  for (const point of concurrencyPoints) {
    activeRequests += point[1]!;
    peakInFlight = Math.max(peakInFlight, activeRequests);
  }
  const observedWindowMs =
    Number.isFinite(earliestStartedMs) &&
    Number.isFinite(latestObservedMs) &&
    latestObservedMs > earliestStartedMs
      ? latestObservedMs - earliestStartedMs
      : null;
  const averageInFlight =
    observedWindowMs === null ? null : activeDurationMs / observedWindowMs;
  const throughputPerMinute =
    observedWindowMs === null
      ? null
      : completedEntries.length / (observedWindowMs / 60_000);
  let outputTokensTotal = 0;
  let outputTokenDurationMs = 0;
  for (const entry of completedEntries) {
    if (entry.completed?.ok !== true) {
      continue;
    }
    const usage = entry.completed.usage;
    const usageRecord =
      typeof usage === "object" && usage !== null
        ? (usage as Record<string, unknown>)
        : undefined;
    const tokens = Number(
      usageRecord?.outputTokens ?? usageRecord?.output_tokens
    );
    const durationMs = Number(entry.completed.duration_ms);
    if (
      Number.isFinite(tokens) &&
      tokens >= 0 &&
      Number.isFinite(durationMs) &&
      durationMs > 0
    ) {
      outputTokensTotal += tokens;
      outputTokenDurationMs += durationMs;
    }
  }
  return {
    requestCount: entries.length,
    completedCount: completedEntries.length,
    pendingCount,
    successfulCount,
    errorCount: errorEntries.length,
    retryAttemptCount,
    postProcessingFailureCount,
    successRate: rate(successfulCount, completedEntries.length),
    errorRate: rate(errorEntries.length, completedEntries.length),
    retryAttemptRate: rate(retryAttemptCount, entries.length),
    postProcessingFailureRate: rate(
      postProcessingFailureCount,
      completedEntries.length
    ),
    latencyMs: {
      sampleSize: completedDurationsMs.length,
      p50: percentile(completedDurationsMs, 0.5),
      p75: percentile(completedDurationsMs, 0.75),
      p90: percentile(completedDurationsMs, 0.9),
      p95: percentile(completedDurationsMs, 0.95),
      mean,
      max: completedDurationsMs.at(-1) ?? null,
    },
    observedWindowMs,
    peakInFlight: concurrencyPoints.length > 0 ? peakInFlight : null,
    averageInFlight,
    throughputPerMinute,
    outputTokensTotal,
    outputTokenDurationMs,
    effectiveOutputTokensPerSecond:
      outputTokenDurationMs > 0
        ? outputTokensTotal / (outputTokenDurationMs / 1000)
        : null,
    errorStatusCounts: [...errorStatusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
  };
}

function latestParquetPath(resultsDir: string): string | undefined {
  if (!existsSync(resultsDir)) {
    return undefined;
  }
  const filename = readdirSync(resultsDir)
    .filter((name) => name.endsWith(".parquet"))
    .sort()
    .at(-1);
  return filename === undefined ? undefined : join(resultsDir, filename);
}

async function buildGpqaSection(record: RunRecord): Promise<{
  readonly summary: z.infer<typeof GpqaPerformanceSummarySchema>;
  readonly analytics: GpqaAnalytics;
  readonly fullReport: PrecomputedGpqaReportFile;
} | null> {
  if (record.args.benchmark !== "gpqa_diamond") {
    return null;
  }
  const parquetPath = latestParquetPath(record.resultsDir);
  if (parquetPath === undefined) {
    return null;
  }
  const file = parquetPath.split("/").at(-1) ?? "results.parquet";
  const rows = await readResultRows(
    asyncBufferFromBytes(new Uint8Array(readFileSync(parquetPath)))
  );
  const report = buildGpqaReport(rows);
  if (report === null) {
    return null;
  }
  const analytics = buildGpqaAnalytics(report.items);
  return {
    summary: {
      task: report.task,
      model: report.model,
      totalGenerationTimeMs: report.totalGenerationTimeMs,
      evaluations: report.evaluations,
      correct: report.correct,
      incorrect: report.incorrect,
      wrong: report.wrong,
      noAnswer: report.noAnswer,
      skipped: report.skipped,
    },
    analytics,
    fullReport: {
      runId: record.id,
      file,
      inference: record.args.inference,
      ...report,
      analytics,
    },
  };
}

export function performanceReportPath(record: RunRecord): string {
  return join(record.root, PERFORMANCE_REPORT_RELATIVE_PATH);
}

export function gpqaReportArtifactPath(record: RunRecord): string {
  return join(record.root, GPQA_REPORT_RELATIVE_PATH);
}

export function localPerformanceReportExists(record: RunRecord): boolean {
  return existsSync(performanceReportPath(record));
}

function writeJsonArtifact(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function buildRunPerformanceReport(
  record: RunRecord,
  computedAt = new Date().toISOString()
): Promise<{
  readonly payload: RunPerformanceReportPayload;
  readonly gpqaReportFile: PrecomputedGpqaReportFile | null;
}> {
  const freezeAtMs = new Date(record.finishedAt ?? computedAt).getTime();
  const freezeMs = Number.isFinite(freezeAtMs)
    ? freezeAtMs
    : Date.parse(computedAt);
  let requestPerf = emptyRequestPerf();
  if (existsSync(record.requestLogPath)) {
    requestPerf = buildRequestPerf(
      parseRequestLogEntries(readFileSync(record.requestLogPath, "utf8")),
      freezeMs
    );
  }
  const gpqaSection = await buildGpqaSection(record);
  return {
    payload: {
      schemaVersion: RUN_PERFORMANCE_REPORT_SCHEMA_VERSION,
      runId: record.id,
      computedAt,
      status: record.status as RunStatus,
      requestPerf,
      gpqa:
        gpqaSection === null
          ? null
          : ({
              summary: gpqaSection.summary,
              analytics: gpqaSection.analytics,
            } as NonNullable<RunPerformanceReportPayload["gpqa"]>),
    },
    gpqaReportFile: gpqaSection?.fullReport ?? null,
  };
}

function errorDetails(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function computeAndPersistRunPerformanceReport(
  record: RunRecord,
  options: { readonly force?: boolean } = {}
): Promise<StoredRunPerformanceReport | undefined> {
  const store = performanceReportStore;
  if (store === undefined) {
    wLog("Skipping performance report; store is not configured", {
      id: record.id,
    });
    return undefined;
  }
  if (!options.force && localPerformanceReportExists(record)) {
    const existing = await store.get(record.id);
    if (existing !== undefined) {
      return existing;
    }
  }
  const computedAt = new Date().toISOString();
  try {
    const { payload, gpqaReportFile } = await buildRunPerformanceReport(
      record,
      computedAt
    );
    writeJsonArtifact(performanceReportPath(record), payload);
    if (gpqaReportFile !== null) {
      writeJsonArtifact(gpqaReportArtifactPath(record), gpqaReportFile);
    }
    const stored: StoredRunPerformanceReport = {
      runId: record.id,
      schemaVersion: payload.schemaVersion,
      computedAt,
      status: "complete",
      error: null,
      report: payload,
    };
    await store.upsert(stored);
    iLog("Persisted run performance report", {
      id: record.id,
      requestCount: payload.requestPerf.requestCount,
      hasGpqa: payload.gpqa !== null,
    });
    return stored;
  } catch (error) {
    const message = errorDetails(error);
    eLog("Failed to compute run performance report", {
      id: record.id,
      error: message,
    });
    const failedPayload: RunPerformanceReportPayload = {
      schemaVersion: RUN_PERFORMANCE_REPORT_SCHEMA_VERSION,
      runId: record.id,
      computedAt,
      status: record.status,
      requestPerf: emptyRequestPerf(),
      gpqa: null,
    };
    try {
      writeJsonArtifact(performanceReportPath(record), failedPayload);
    } catch (writeError) {
      wLog("Failed to write failed performance report artifact", {
        id: record.id,
        error: errorDetails(writeError),
      });
    }
    const stored: StoredRunPerformanceReport = {
      runId: record.id,
      schemaVersion: RUN_PERFORMANCE_REPORT_SCHEMA_VERSION,
      computedAt,
      status: "failed",
      error: message,
      report: failedPayload,
    };
    try {
      await store.upsert(stored);
    } catch (storeError) {
      eLog("Failed to persist failed performance report", {
        id: record.id,
        error: errorDetails(storeError),
      });
    }
    return stored;
  }
}

export function __testOnlyResetPerformanceReportStore(): void {
  performanceReportStore = undefined;
}
