import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { eLog, iLog, wLog } from "../internal/log";
import { z } from "../internal/zod";
import { isDigitalOceanInferenceBaseUrl } from "../providers/digitalocean-inference";
import {
  asyncBufferFromBytes,
  readResultRows,
  summarizeChunkRows,
} from "../results/parquet";
import { uploadRunBundle } from "./run-artifact-upload";
import type { UploadResult } from "./run-artifact-upload";
import type { RunMetadata, RunMetadataStore } from "./run-metadata-store";
import {
  computeAndPersistRunPerformanceReport,
  localPerformanceReportExists,
} from "./run-performance-report";

export const RUNS_DIR = "logs/api";

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type UploadStatus = "pending" | "uploading" | "complete" | "failed";

export interface RunInference {
  readonly baseUrl: string;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens?: number | undefined;
  readonly reasoningEffort?:
    | "xhigh"
    | "high"
    | "medium"
    | "low"
    | "minimal"
    | "none"
    | undefined;
  readonly timeoutMs?: number | undefined;
  readonly completionTimeoutMs?: number | undefined;
  readonly endpointId?: string | undefined;
  readonly costTier?: "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  readonly sort?: "price" | "throughput" | "latency" | "exacto" | undefined;
  readonly providerOnly?: readonly string[] | undefined;
  readonly allowFallbacks?: boolean | undefined;
  readonly cloudflareVersion?: string | undefined;
  readonly costQualityTradeoff?: number | undefined;
  readonly pinModel?: boolean | undefined;
}

export interface RunExecution {
  readonly epochs: number;
  readonly concurrency: number;
  readonly unordered?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly start?: number | undefined;
  readonly end?: number | undefined;
  readonly maxRetries?: number | undefined;
}

export interface RunArgs {
  readonly benchmark:
    | "gpqa_diamond"
    | "tau_bench_verified_airline"
    | "deep_swe"
    | "swe_bench_verified"
    | "terminal_bench"
    | "swe_atlas_qa"
    | "swe_atlas_tw"
    | "swe_atlas_rf";
  readonly triggeredByEmail?: string | undefined;
  readonly runKind?: "benchmark" | "gpqa_retry_arm" | undefined;
  readonly sourceRunId?: string | undefined;
  readonly campaignId?: string | undefined;
  readonly campaignArm?: "original" | "comparison" | undefined;
  readonly sampleIds?: readonly string[] | undefined;
  readonly judgeModel?: string | undefined;
  readonly inference: RunInference;
  readonly execution: RunExecution;
  readonly logLevel?: string | undefined;
}

const DATASET_SIZES: Readonly<Record<RunArgs["benchmark"], number>> = {
  gpqa_diamond: 198,
  tau_bench_verified_airline: 50,
  deep_swe: 113,
  swe_bench_verified: 500,
  terminal_bench: 89,
  swe_atlas_qa: 124,
  swe_atlas_tw: 90,
  swe_atlas_rf: 65,
};

const SWE_ATLAS_JUDGE_BASE_URL = "https://inference.do-ai.run/v1" as const;

function isSweAtlasBenchmark(benchmark: RunArgs["benchmark"]): boolean {
  return (
    benchmark === "swe_atlas_qa" ||
    benchmark === "swe_atlas_tw" ||
    benchmark === "swe_atlas_rf"
  );
}

export interface RunRecord {
  readonly id: string;
  status: RunStatus;
  readonly args: RunArgs;
  readonly argv: readonly string[];
  pid: number | null;
  readonly startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  expectedQuestions: number;
  completedQuestions: number;
  skippedQuestions: number;
  totalEvaluations: number;
  completedEvaluations: number;
  skippedEvaluations: number;
  completionPercentage: number;
  qualityScore: number | null;
  disabled: boolean;
  cancelRequestedAt: string | null;
  failureReason: string | null;
  uploadStatus: UploadStatus;
  uploadError: string | null;
  uploadedAt: string | null;
  spacesBucket: string | null;
  spacesPrefix: string | null;
  manifestKey: string | null;
  readonly root: string;
  readonly logPath: string;
  readonly requestLogPath: string;
  readonly resultsDir: string;
}

const records = new Map<string, RunRecord>();
let metadataStore: RunMetadataStore | undefined;

const ProgressFileSchema = z.object({
  processed: z.number().int().min(0).optional(),
  completed: z.number().int().min(0),
  skipped: z.number().int().min(0).optional(),
  total: z.number().int().positive(),
  percentage: z.number().min(0).max(100),
  updatedAt: z.iso.datetime(),
});

export function configureRunMetadataStore(store: RunMetadataStore): void {
  metadataStore = store;
}

function requiredMetadataStore(): RunMetadataStore {
  if (metadataStore === undefined) {
    throw new Error("Run metadata store is not configured");
  }
  return metadataStore;
}

async function syncMetadata(record: RunRecord): Promise<void> {
  await requiredMetadataStore().upsert(record);
}

function runDir(id: string): string {
  return join(RUNS_DIR, id);
}

function recordPath(id: string): string {
  return join(runDir(id), "run.json");
}

function expectedQuestionCount(args: RunArgs): number {
  if (args.sampleIds !== undefined) {
    return args.sampleIds.length;
  }
  const { end, limit, start = 0 } = args.execution;
  if (limit !== undefined) {
    return limit;
  }
  const datasetSize = DATASET_SIZES[args.benchmark];
  return (end ?? datasetSize) - start;
}

function expectedEvaluationCount(args: RunArgs): number {
  return expectedQuestionCount(args) * args.execution.epochs;
}

interface RefreshedRunResults {
  readonly hasValidParquet: boolean;
  readonly accuracy: number | null;
  readonly issue: string | null;
}

async function refreshQuestionCounts(
  record: RunRecord
): Promise<RefreshedRunResults> {
  record.expectedQuestions = expectedQuestionCount(record.args);
  record.totalEvaluations = expectedEvaluationCount(record.args);
  if (!existsSync(record.resultsDir)) {
    return {
      hasValidParquet: false,
      accuracy: null,
      issue: "Results directory was not created",
    };
  }
  record.completedQuestions = 0;
  record.skippedQuestions = 0;
  record.qualityScore = null;
  let parquetFiles: string[];
  try {
    parquetFiles = readdirSync(record.resultsDir)
      .filter((name) => name.endsWith(".parquet"))
      .sort();
  } catch (error) {
    const issue = `Failed to list result files: ${errorDetails(error)}`;
    eLog("Failed to list benchmark result files", {
      id: record.id,
      resultsDir: record.resultsDir,
      error: issue,
    });
    appendRunLog(record, "error", "Result directory could not be read", {
      resultsDir: record.resultsDir,
      error: issue,
    });
    return { hasValidParquet: false, accuracy: null, issue };
  }
  const filename = parquetFiles.at(-1);
  if (filename === undefined) {
    return {
      hasValidParquet: false,
      accuracy: null,
      issue: "No Parquet result file was created",
    };
  }
  try {
    const bytes = new Uint8Array(
      readFileSync(join(record.resultsDir, filename))
    );
    const rows = await readResultRows(asyncBufferFromBytes(bytes));
    const summary = summarizeChunkRows(rows);
    if (summary !== null) {
      record.completedQuestions = summary.totalQuestions;
      record.skippedQuestions = summary.skippedQuestions;
      record.skippedEvaluations = rows.filter(
        (row) => row.score_value === "S"
      ).length;
      record.completedEvaluations = rows.length - record.skippedEvaluations;
      record.completionPercentage =
        record.totalEvaluations === 0
          ? 100
          : (rows.length / record.totalEvaluations) * 100;
      return {
        hasValidParquet: true,
        accuracy: summary.accuracy,
        issue: null,
      };
    }
    return {
      hasValidParquet: false,
      accuracy: null,
      issue: `Parquet result ${filename} did not contain summarizable rows`,
    };
  } catch (error) {
    const issue = `Failed to read Parquet result ${filename}: ${errorDetails(error)}`;
    eLog("Failed to read run question counts from Parquet", {
      id: record.id,
      error: issue,
    });
    appendRunLog(record, "error", "Parquet result validation failed", {
      error: issue,
    });
    return { hasValidParquet: false, accuracy: null, issue };
  }
}

export function resolveFinishedRunStatus(input: {
  readonly failedForMetadata: boolean;
  readonly cancelRequested: boolean;
  readonly exitCode: number | null;
  readonly hasCompleteParquet: boolean;
  readonly hasExcessiveSkips: boolean;
}): RunStatus {
  if (input.failedForMetadata) {
    return "failed";
  }
  if (input.cancelRequested) {
    return "cancelled";
  }
  if (input.hasExcessiveSkips) {
    return "failed";
  }
  return input.exitCode === 0 || input.hasCompleteParquet
    ? "succeeded"
    : "failed";
}

export function hasCompleteEvaluationResults(input: {
  readonly hasValidParquet: boolean;
  readonly completedEvaluations: number;
  readonly skippedEvaluations: number;
  readonly totalEvaluations: number;
}): boolean {
  return (
    input.hasValidParquet &&
    input.totalEvaluations > 0 &&
    input.completedEvaluations + input.skippedEvaluations ===
      input.totalEvaluations
  );
}

function hasExcessiveSkippedEvaluations(input: {
  readonly completedEvaluations: number;
  readonly skippedEvaluations: number;
}): boolean {
  return input.skippedEvaluations > input.completedEvaluations;
}

function persist(record: RunRecord): void {
  try {
    writeFileSync(recordPath(record.id), JSON.stringify(record, null, 2));
  } catch (error) {
    wLog("Failed to persist run record", {
      id: record.id,
      error: String(error),
    });
  }
}

const MAX_FAILURE_REASON_LENGTH = 16_000;

function errorDetails(error: unknown): string {
  const details: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      details.push(`${current.name}: ${current.message || "(no message)"}`);
      current = current.cause;
      continue;
    }
    details.push(String(current));
    break;
  }
  return details.join(" <- caused by: ");
}

function normalizeFailureReason(reason: string): string {
  const normalized = reason.replaceAll("\0", "").trim();
  return normalized.length <= MAX_FAILURE_REASON_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_FAILURE_REASON_LENGTH)}…`;
}

function parseLogRecord(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function appendRunLog(
  record: RunRecord,
  level: "info" | "warn" | "error",
  message: string,
  context: Record<string, unknown> = {}
): void {
  try {
    mkdirSync(join(record.root, "logs"), { recursive: true });
    appendFileSync(
      record.logPath,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        source: "benchmark-api-runtime",
        level,
        message,
        ...context,
      })}\n`
    );
  } catch (error) {
    wLog("Failed to append benchmark API runtime log", {
      id: record.id,
      message,
      error: errorDetails(error),
    });
  }
}

function loggedFailureReason(logTail: string): string | undefined {
  const lines = logTail
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.toReversed()) {
    const marker = "Benchmark failed:";
    const markerIndex = line.indexOf(marker);
    if (markerIndex !== -1) {
      return normalizeFailureReason(line.slice(markerIndex + marker.length));
    }
  }
  for (const line of lines.toReversed()) {
    const parsed = parseLogRecord(line);
    if (parsed !== undefined) {
      if (
        parsed["source"] === "benchmark-api-runtime" &&
        typeof parsed["failureReason"] === "string"
      ) {
        return normalizeFailureReason(parsed["failureReason"]);
      }
      if (
        parsed["source"] === "benchmark-api-runtime" &&
        typeof parsed["error"] === "string"
      ) {
        const message =
          typeof parsed["message"] === "string" ? `${parsed["message"]}: ` : "";
        return normalizeFailureReason(`${message}${parsed["error"]}`);
      }
    }
    if (/(?:^|\b)(?:error|exception|fiberfailure)\b/i.test(line)) {
      return normalizeFailureReason(line);
    }
  }
  return undefined;
}

export function resolveFinishedRunFailureReason(input: {
  readonly status: RunStatus;
  readonly exitCode: number | null;
  readonly logTail: string;
  readonly resultIssue: string | null;
  readonly completedEvaluations: number;
  readonly skippedEvaluations: number;
  readonly totalEvaluations: number;
}): string | null {
  if (input.status !== "failed") {
    return null;
  }
  if (hasExcessiveSkippedEvaluations(input)) {
    return normalizeFailureReason(
      `The benchmark run failed because skipped evaluations (${input.skippedEvaluations}) ` +
        `exceeded completed evaluations (${input.completedEvaluations}), out of ` +
        `${input.totalEvaluations} total evaluations. Review the skipped sample ` +
        "explanations in the run report for the underlying errors."
    );
  }
  const logged = loggedFailureReason(input.logTail);
  if (logged !== undefined) {
    return logged;
  }
  const progress =
    `${input.completedEvaluations}/${input.totalEvaluations} completed, ` +
    `${input.skippedEvaluations} skipped`;
  const resultIssue =
    input.resultIssue === null ? "" : ` ${input.resultIssue}.`;
  if (input.exitCode === null) {
    return normalizeFailureReason(
      "The benchmark process disappeared without an observable exit code. " +
        "The API service may have restarted, or the process may have been " +
        `terminated externally (including OOM/SIGKILL).${resultIssue} ${progress}.`
    );
  }
  if (input.exitCode === 137) {
    return normalizeFailureReason(
      "The benchmark process was killed by SIGKILL (exit code 137), commonly " +
        `because of an out-of-memory condition.${resultIssue} ${progress}.`
    );
  }
  if (input.exitCode === 143) {
    return normalizeFailureReason(
      "The benchmark process was terminated by SIGTERM (exit code 143)." +
        `${resultIssue} ${progress}.`
    );
  }
  return normalizeFailureReason(
    `The benchmark process exited with code ${input.exitCode}.` +
      `${resultIssue} ${progress}. Review the final run-log entries for the underlying error.`
  );
}

function removeUploadedLocalArtifacts(record: RunRecord): void {
  for (const path of [
    join(record.root, "logs"),
    join(record.root, "requests"),
    join(record.root, "reports"),
    record.resultsDir,
    join(record.root, "manifest.json"),
    join(record.root, "progress.json"),
  ]) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (error) {
      wLog("Failed to remove uploaded local artifact", {
        id: record.id,
        path,
        error: String(error),
      });
    }
  }
}

function isAlive(pid: number | null): boolean {
  if (pid === null) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function loadPersistedRuns(): Promise<void> {
  if (!existsSync(RUNS_DIR)) {
    return;
  }
  for (const id of readdirSync(RUNS_DIR)) {
    const path = recordPath(id);
    if (records.has(id) || !existsSync(path)) {
      continue;
    }
    try {
      const record = JSON.parse(readFileSync(path, "utf8")) as RunRecord;
      Object.assign(record, {
        root: record.root ?? runDir(id),
        requestLogPath:
          record.requestLogPath ??
          join(runDir(id), "requests", "requests.jsonl"),
        resultsDir: record.resultsDir ?? join(runDir(id), "results"),
      });
      record.cancelRequestedAt ??= null;
      record.failureReason ??= null;
      record.uploadStatus ??= "pending";
      record.uploadError ??= null;
      record.uploadedAt ??= null;
      record.spacesBucket ??= null;
      record.spacesPrefix ??= null;
      record.manifestKey ??= null;
      record.expectedQuestions ??= expectedQuestionCount(record.args);
      record.completedQuestions ??= 0;
      record.skippedQuestions ??= 0;
      record.totalEvaluations ??= expectedEvaluationCount(record.args);
      record.completedEvaluations ??=
        record.status === "succeeded"
          ? record.completedQuestions * record.args.execution.epochs
          : 0;
      record.skippedEvaluations ??=
        record.status === "succeeded"
          ? record.skippedQuestions * record.args.execution.epochs
          : 0;
      record.completionPercentage ??= record.status === "succeeded" ? 100 : 0;
      record.qualityScore ??= null;
      record.disabled ??= false;
      if (record.uploadStatus === "uploading") {
        record.uploadStatus = "pending";
      }
      records.set(id, record);
      if (record.status === "running" && !isAlive(record.pid)) {
        appendRunLog(
          record,
          "warn",
          "Recovered run process stopped; resolving outcome from persisted results",
          {
            pid: record.pid,
            completedEvaluations: record.completedEvaluations,
            skippedEvaluations: record.skippedEvaluations,
            totalEvaluations: record.totalEvaluations,
          }
        );
        await finishRun(record, null);
        continue;
      }
      if (record.status !== "running" && record.uploadStatus !== "complete") {
        const refreshed = await refreshQuestionCounts(record);
        const hasCompleteParquet = hasCompleteEvaluationResults({
          hasValidParquet: refreshed.hasValidParquet,
          completedEvaluations: record.completedEvaluations,
          skippedEvaluations: record.skippedEvaluations,
          totalEvaluations: record.totalEvaluations,
        });
        const hasExcessiveSkips = hasExcessiveSkippedEvaluations(record);
        if (
          record.status === "failed" &&
          hasCompleteParquet &&
          !hasExcessiveSkips
        ) {
          record.status = "succeeded";
          record.failureReason = null;
        }
        record.qualityScore =
          record.status === "succeeded" ? refreshed.accuracy : null;
      }
      await syncMetadata(record);
      if (record.status === "running") {
        appendRunLog(record, "warn", "API service resumed monitoring run", {
          pid: record.pid,
          completedEvaluations: record.completedEvaluations,
          skippedEvaluations: record.skippedEvaluations,
          totalEvaluations: record.totalEvaluations,
        });
        watchRecoveredRun(record);
        watchRunProgress(record);
      } else if (record.uploadStatus !== "complete") {
        if (!localPerformanceReportExists(record)) {
          await computeAndPersistRunPerformanceReport(record, {
            force: true,
          });
        }
        scheduleUpload(record);
      } else {
        removeUploadedLocalArtifacts(record);
      }
    } catch (error) {
      throw new Error(`Failed to reconcile persisted run ${id}`, {
        cause: error,
      });
    }
  }
}

export function buildArgv(args: RunArgs): string[] {
  const { execution, inference } = args;
  const argv = [
    "--benchmark",
    args.benchmark,
    "--model",
    inference.model,
    "--epochs",
    String(execution.epochs),
    "--concurrency",
    String(execution.concurrency),
  ];
  const numeric: readonly [string, number | undefined][] = [
    ["--limit", execution.limit],
    ["--start", execution.start],
    ["--end", execution.end],
  ];
  for (const [flag, value] of numeric) {
    if (value !== undefined) {
      argv.push(flag, String(value));
    }
  }
  if (execution.unordered === true) {
    argv.push("--unordered");
  }
  const solverConfig = {
    temperature: inference.temperature,
    ...(inference.maxTokens !== undefined && {
      maxTokens: inference.maxTokens,
    }),
    ...(inference.reasoningEffort !== undefined && {
      reasoningEffort: inference.reasoningEffort,
    }),
    ...(inference.timeoutMs !== undefined && {
      timeoutMs: inference.timeoutMs,
    }),
    ...(inference.completionTimeoutMs !== undefined && {
      completionTimeoutMs: inference.completionTimeoutMs,
    }),
    ...(inference.endpointId !== undefined && {
      endpointId: inference.endpointId,
    }),
    ...(inference.costTier !== undefined && { costTier: inference.costTier }),
    ...(inference.sort !== undefined && { sort: inference.sort }),
    ...(inference.providerOnly !== undefined && {
      providerOnly: inference.providerOnly,
    }),
    ...(inference.allowFallbacks !== undefined && {
      allowFallbacks: inference.allowFallbacks,
    }),
    ...(inference.cloudflareVersion !== undefined && {
      cloudflareVersion: inference.cloudflareVersion,
    }),
    ...(inference.costQualityTradeoff !== undefined && {
      costQualityTradeoff: inference.costQualityTradeoff,
    }),
    ...(inference.pinModel !== undefined && { pinModel: inference.pinModel }),
    ...(execution.maxRetries !== undefined && {
      maxRetries: execution.maxRetries,
    }),
    ...(isSweAtlasBenchmark(args.benchmark) &&
      args.judgeModel !== undefined && {
        judgeModel: args.judgeModel,
      }),
  };
  argv.push("--solver-config", JSON.stringify(solverConfig));
  for (const sampleId of args.sampleIds ?? []) {
    argv.push("--sample-id", sampleId);
  }
  return argv;
}

export function activeRunCount(): number {
  return [...records.values()].filter((record) => record.status === "running")
    .length;
}

export class ActiveRunLimitError extends Error {
  override readonly name = "ActiveRunLimitError";
}

export function childEnvironment(
  args: RunArgs,
  apiKey: string,
  id: string,
  requestLogPath: string,
  resultsDir: string,
  simulatorApiKey?: string
): Record<string, string | undefined> {
  const excluded = new Set([
    "BENCH_API_TOKEN",
    "BENCH_RUN_TRIGGER_SECRET",
    "REQUEST_LOG",
    "REQUEST_LOG_FILE",
    "REQUEST_LOG_CONSOLE",
    "SPACES_ACCESS_KEY_ID",
    "SPACES_SECRET_ACCESS_KEY",
    "SWE_ATLAS_JUDGE_API_KEY",
    "SWE_ATLAS_JUDGE_BASE_URL",
    "SWE_ATLAS_JUDGE_MODEL",
  ]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !excluded.has(name) &&
        !name.startsWith("TAU_AIRLINE_USER_SIMULATOR_") &&
        !name.startsWith("MYSQL_") &&
        !name.startsWith("SPACES_")
    )
  );
  return {
    ...env,
    OPENROUTER_API_KEY: apiKey,
    OPENROUTER_BASE_URL: args.inference.baseUrl,
    BENCH_CHILD_WORKFLOW_ID: id,
    BENCH_RESULTS_DIR: resultsDir,
    BENCH_PROGRESS_FILE: join(resultsDir, "..", "progress.json"),
    REQUEST_LOG_FILE: requestLogPath,
    ...(args.benchmark === "tau_bench_verified_airline" && {
      TAU_AIRLINE_USER_SIMULATOR_API_KEY: isDigitalOceanInferenceBaseUrl(
        args.inference.baseUrl
      )
        ? apiKey
        : simulatorApiKey,
    }),
    ...(isSweAtlasBenchmark(args.benchmark) && {
      SWE_ATLAS_JUDGE_API_KEY: process.env["SWE_ATLAS_JUDGE_API_KEY"],
      SWE_ATLAS_JUDGE_BASE_URL,
    }),
    ...(args.logLevel !== undefined && { LOG_LEVEL: args.logLevel }),
  };
}

function failForMetadata(record: RunRecord, error: unknown): void {
  const reason = normalizeFailureReason(
    `MySQL metadata write failed: ${errorDetails(error)}`
  );
  const shouldTerminate =
    record.status === "running" ||
    (record.status === "cancelled" && record.finishedAt === null);
  if (shouldTerminate && record.pid !== null) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch (signalError) {
      wLog("Failed to stop run after metadata write failure", {
        id: record.id,
        error: String(signalError),
      });
    }
  }
  record.status = "failed";
  record.finishedAt ??= new Date().toISOString();
  record.failureReason = reason;
  persist(record);
  appendRunLog(record, "error", "Benchmark run failed", {
    failureReason: reason,
  });
  eLog("Benchmark run failed because MySQL metadata could not be written", {
    id: record.id,
    error: reason,
  });
}

function scheduleUpload(record: RunRecord): void {
  if (record.status === "running" || record.uploadStatus === "uploading") {
    return;
  }
  void (async () => {
    record.uploadStatus = "uploading";
    record.uploadError = null;
    persist(record);
    appendRunLog(record, "info", "Starting run artifact upload", {
      benchmarkStatus: record.status,
      failureReason: record.failureReason,
    });
    try {
      await syncMetadata(record);
    } catch (error) {
      failForMetadata(record, error);
      return;
    }
    let result: UploadResult;
    try {
      result = await uploadRunBundle({
        id: record.id,
        benchmark: record.args.benchmark,
        root: record.root,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        status: record.status,
        exitCode: record.exitCode,
        failureReason: record.failureReason,
      });
    } catch (error) {
      record.uploadStatus = "failed";
      record.uploadError = errorDetails(error);
      persist(record);
      appendRunLog(record, "error", "Run artifact upload failed", {
        error: record.uploadError,
      });
      try {
        await syncMetadata(record);
      } catch (metadataError) {
        failForMetadata(record, metadataError);
      }
      eLog("Benchmark run artifact upload failed", {
        id: record.id,
        error: String(error),
      });
      return;
    }
    record.uploadStatus = "complete";
    record.uploadedAt = result.uploadedAt;
    record.spacesBucket = result.bucket;
    record.spacesPrefix = result.prefix;
    record.manifestKey = result.manifestKey;
    persist(record);
    try {
      await syncMetadata(record);
    } catch (error) {
      failForMetadata(record, error);
      return;
    }
    iLog("Benchmark run artifacts uploaded", {
      id: record.id,
      bucket: result.bucket,
      prefix: result.prefix,
    });
    removeUploadedLocalArtifacts(record);
  })();
}

export async function refreshLiveProgress(record: RunRecord): Promise<void> {
  const path = join(record.root, "progress.json");
  if (!existsSync(path)) {
    return;
  }
  let parsed: z.infer<typeof ProgressFileSchema>;
  try {
    parsed = ProgressFileSchema.parse(
      JSON.parse(readFileSync(path, "utf8")) as unknown
    );
  } catch (error) {
    wLog("Ignoring invalid benchmark progress file", {
      id: record.id,
      error: String(error),
    });
    return;
  }
  const processed = parsed.processed ?? parsed.completed;
  const skipped = parsed.skipped ?? 0;
  if (
    processed > parsed.total ||
    skipped > processed ||
    parsed.completed + skipped !== processed
  ) {
    wLog("Ignoring inconsistent benchmark progress file", {
      id: record.id,
    });
    return;
  }
  if (
    parsed.percentage === record.completionPercentage &&
    parsed.total === record.totalEvaluations &&
    parsed.completed === record.completedEvaluations &&
    skipped === record.skippedEvaluations
  ) {
    return;
  }
  const previousPercentage = record.completionPercentage;
  record.totalEvaluations = parsed.total;
  record.completedEvaluations = parsed.completed;
  record.skippedEvaluations = skipped;
  record.completionPercentage = parsed.percentage;
  persist(record);
  const previousMilestone = Math.floor(previousPercentage / 10);
  const currentMilestone = Math.floor(parsed.percentage / 10);
  if (currentMilestone > previousMilestone || parsed.percentage === 100) {
    appendRunLog(
      record,
      "info",
      parsed.percentage === 100
        ? "All evaluations processed; final result aggregation and Parquet persistence are still pending"
        : "Benchmark progress milestone",
      {
        percentage: parsed.percentage,
        completedEvaluations: parsed.completed,
        skippedEvaluations: skipped,
        totalEvaluations: parsed.total,
      }
    );
  }
  await syncMetadata(record);
}

function watchRunProgress(record: RunRecord): void {
  let updating = false;
  const timer = setInterval(() => {
    if (record.status !== "running") {
      clearInterval(timer);
      return;
    }
    if (updating) {
      return;
    }
    updating = true;
    void refreshLiveProgress(record)
      .catch((error) => failForMetadata(record, error))
      .finally(() => {
        updating = false;
      });
  }, 1000);
  timer.unref();
}

async function finishRun(
  record: RunRecord,
  exitCode: number | null
): Promise<void> {
  try {
    await refreshLiveProgress(record);
  } catch (error) {
    failForMetadata(record, error);
    return;
  }
  const failedForMetadata = record.failureReason?.startsWith(
    "MySQL metadata write failed:"
  );
  const existingFailureReason = record.failureReason;
  record.exitCode = exitCode;
  record.finishedAt = new Date().toISOString();
  appendRunLog(record, "info", "Benchmark process exit observed", {
    exitCode,
    completedEvaluations: record.completedEvaluations,
    skippedEvaluations: record.skippedEvaluations,
    totalEvaluations: record.totalEvaluations,
  });
  const refreshed = await refreshQuestionCounts(record);
  const hasCompleteParquet = hasCompleteEvaluationResults({
    hasValidParquet: refreshed.hasValidParquet,
    completedEvaluations: record.completedEvaluations,
    skippedEvaluations: record.skippedEvaluations,
    totalEvaluations: record.totalEvaluations,
  });
  const hasExcessiveSkips = hasExcessiveSkippedEvaluations(record);
  record.status = resolveFinishedRunStatus({
    failedForMetadata: Boolean(failedForMetadata),
    cancelRequested: record.cancelRequestedAt !== null,
    exitCode,
    hasCompleteParquet,
    hasExcessiveSkips,
  });
  record.qualityScore =
    record.status === "succeeded" ? refreshed.accuracy : null;
  if (record.status === "succeeded") {
    record.completionPercentage = 100;
    record.failureReason = null;
    appendRunLog(record, "info", "Benchmark run completed successfully", {
      exitCode,
      completedEvaluations: record.completedEvaluations,
      skippedEvaluations: record.skippedEvaluations,
      totalEvaluations: record.totalEvaluations,
      qualityScore: record.qualityScore,
    });
  } else if (record.status === "failed") {
    record.failureReason =
      existingFailureReason !== null &&
      (Boolean(failedForMetadata) || !hasExcessiveSkips)
        ? existingFailureReason
        : resolveFinishedRunFailureReason({
            status: record.status,
            exitCode,
            logTail: readTail(record.logPath, 200),
            resultIssue: refreshed.issue,
            completedEvaluations: record.completedEvaluations,
            skippedEvaluations: record.skippedEvaluations,
            totalEvaluations: record.totalEvaluations,
          });
    appendRunLog(record, "error", "Benchmark run failed", {
      exitCode,
      failureReason: record.failureReason,
      resultIssue: refreshed.issue,
      completedEvaluations: record.completedEvaluations,
      skippedEvaluations: record.skippedEvaluations,
      totalEvaluations: record.totalEvaluations,
    });
  }
  persist(record);
  try {
    await syncMetadata(record);
  } catch (error) {
    failForMetadata(record, error);
    return;
  }
  iLog("Benchmark run finished", {
    id: record.id,
    exitCode,
    status: record.status,
    failureReason: record.failureReason,
  });
  if (record.status === "failed") {
    eLog("Benchmark run failed", {
      id: record.id,
      exitCode,
      failureReason: record.failureReason,
    });
  }
  await computeAndPersistRunPerformanceReport(record);
  scheduleUpload(record);
}

function watchRecoveredRun(record: RunRecord): void {
  const timer = setInterval(() => {
    if (record.status !== "running" || isAlive(record.pid)) {
      return;
    }
    clearInterval(timer);
    appendRunLog(
      record,
      "warn",
      "Recovered benchmark process stopped; resolving outcome from persisted results",
      {
        pid: record.pid,
        completedEvaluations: record.completedEvaluations,
        skippedEvaluations: record.skippedEvaluations,
        totalEvaluations: record.totalEvaluations,
      }
    );
    void finishRun(record, null);
  }, 5000);
  timer.unref();
}

export async function startRun(
  args: RunArgs,
  options: {
    readonly apiKey: string;
    readonly simulatorApiKey?: string;
    readonly maxActiveRuns: number;
  }
): Promise<RunRecord> {
  if (activeRunCount() >= options.maxActiveRuns) {
    throw new ActiveRunLimitError("too many active runs");
  }
  const id = randomUUID();
  const directory = runDir(id);
  const logsDir = join(directory, "logs");
  const requestsDir = join(directory, "requests");
  const resultsDir = join(directory, "results");
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(requestsDir, { recursive: true });
  mkdirSync(resultsDir, { recursive: true });
  const logPath = join(logsDir, "run.log");
  const requestLogPath = join(requestsDir, "requests.jsonl");
  const argv = buildArgv(args);
  const record: RunRecord = {
    id,
    status: "running",
    args,
    argv,
    pid: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    expectedQuestions: expectedQuestionCount(args),
    completedQuestions: 0,
    skippedQuestions: 0,
    totalEvaluations: expectedEvaluationCount(args),
    completedEvaluations: 0,
    skippedEvaluations: 0,
    completionPercentage: 0,
    qualityScore: null,
    disabled: false,
    cancelRequestedAt: null,
    failureReason: null,
    uploadStatus: "pending",
    uploadError: null,
    uploadedAt: null,
    spacesBucket: null,
    spacesPrefix: null,
    manifestKey: null,
    root: directory,
    logPath,
    requestLogPath,
    resultsDir,
  };
  records.set(id, record);
  persist(record);
  appendRunLog(record, "info", "Benchmark run accepted", {
    benchmark: args.benchmark,
    model: args.inference.model,
    baseUrl: args.inference.baseUrl,
    epochs: args.execution.epochs,
    concurrency: args.execution.concurrency,
    unordered: args.execution.unordered ?? false,
    expectedEvaluations: record.totalEvaluations,
    triggeredByEmail: args.triggeredByEmail,
  });
  try {
    await syncMetadata(record);
  } catch (error) {
    failForMetadata(record, error);
    throw error;
  }

  const fd = openSync(logPath, "a");
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn({
      cmd: [process.execPath, "src/cli/index.ts", ...argv],
      cwd: process.cwd(),
      env: childEnvironment(
        args,
        options.apiKey,
        id,
        requestLogPath,
        resultsDir,
        options.simulatorApiKey
      ),
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
    });
  } catch (error) {
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    record.failureReason = normalizeFailureReason(
      `Failed to start benchmark process: ${errorDetails(error)}`
    );
    persist(record);
    appendRunLog(record, "error", "Benchmark run failed to start", {
      failureReason: record.failureReason,
    });
    eLog("Benchmark run failed to start", {
      id: record.id,
      failureReason: record.failureReason,
    });
    await syncMetadata(record);
    throw error;
  } finally {
    closeSync(fd);
  }
  record.pid = child.pid;
  persist(record);
  appendRunLog(record, "info", "Benchmark child process started", {
    pid: child.pid,
  });
  iLog("Benchmark run started", { id, pid: child.pid, argv: argv.join(" ") });
  watchRunProgress(record);

  void child.exited
    .then((exitCode) => finishRun(record, exitCode))
    .catch((error) => {
      const reason = normalizeFailureReason(
        `Failed while observing benchmark process exit: ${errorDetails(error)}`
      );
      record.failureReason = reason;
      appendRunLog(record, "error", "Benchmark process watcher failed", {
        failureReason: reason,
      });
      return finishRun(record, null);
    });

  return record;
}

export function listRuns(): readonly RunRecord[] {
  return [...records.values()]
    .filter(({ args }) => (args.runKind ?? "benchmark") === "benchmark")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getRun(id: string): RunRecord | undefined {
  return records.get(id);
}

export async function listRunMetadata(): Promise<readonly RunMetadata[]> {
  const metadata = await requiredMetadataStore().list();
  return metadata.filter(
    ({ args }) => (args.runKind ?? "benchmark") === "benchmark"
  );
}

export async function getRunMetadata(
  id: string
): Promise<RunMetadata | undefined> {
  return requiredMetadataStore().get(id);
}

export async function setRunDisabled(
  id: string,
  disabled: boolean
): Promise<RunMetadata | undefined> {
  const metadata = await getRunMetadata(id);
  if (metadata === undefined) {
    return undefined;
  }
  const record = records.get(id);
  if (record !== undefined) {
    record.disabled = disabled;
    persist(record);
    await syncMetadata(record);
  } else {
    await requiredMetadataStore().setDisabled(id, disabled);
  }
  return { ...metadata, disabled };
}

export async function cancelRun(id: string): Promise<RunRecord | undefined> {
  const record = records.get(id);
  if (record === undefined || record.status !== "running") {
    return record;
  }
  record.cancelRequestedAt = new Date().toISOString();
  record.status = "cancelled";
  record.failureReason = null;
  persist(record);
  appendRunLog(record, "warn", "Benchmark cancellation requested", {
    pid: record.pid,
    cancelRequestedAt: record.cancelRequestedAt,
  });
  try {
    await syncMetadata(record);
  } catch (error) {
    failForMetadata(record, error);
    throw error;
  }
  if (record.pid !== null) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch (error) {
      wLog("Failed to signal run", { id, error: String(error) });
    }
  }
  return record;
}

export function readTail(path: string, lines: number): string {
  if (!existsSync(path)) {
    return "";
  }
  const content = readFileSync(path, "utf8").split("\n");
  return content.slice(Math.max(0, content.length - lines)).join("\n");
}
