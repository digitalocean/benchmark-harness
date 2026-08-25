import { randomUUID } from "node:crypto";
import {
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

import { iLog, wLog } from "../internal/log";
import { z } from "../internal/zod";
import {
  asyncBufferFromBytes,
  readResultRows,
  summarizeChunkRows,
} from "../results/parquet";
import { uploadRunBundle } from "./run-artifact-upload";
import type { UploadResult } from "./run-artifact-upload";
import type { RunMetadata, RunMetadataStore } from "./run-metadata-store";

export const RUNS_DIR = "logs/api";

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type UploadStatus = "pending" | "uploading" | "complete" | "failed";

export interface RunInference {
  readonly baseUrl: string;
  readonly model: string;
  readonly temperature: 0 | 0.5;
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
  readonly endpointId?: string | undefined;
  readonly costTier?: "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  readonly sort?: "price" | "throughput" | "latency" | "exacto" | undefined;
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
  readonly benchmark: "gpqa_diamond" | "tau_bench_verified_airline";
  readonly triggeredByEmail?: string | undefined;
  readonly inference: RunInference;
  readonly execution: RunExecution;
  readonly logLevel?: string | undefined;
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
  const { end, limit, start = 0 } = args.execution;
  if (limit !== undefined) {
    return limit;
  }
  const datasetSize =
    args.benchmark === "tau_bench_verified_airline" ? 50 : 198;
  return (end ?? datasetSize) - start;
}

function expectedEvaluationCount(args: RunArgs): number {
  return expectedQuestionCount(args) * args.execution.epochs;
}

interface RefreshedRunResults {
  readonly hasValidParquet: boolean;
  readonly accuracy: number | null;
}

async function refreshQuestionCounts(
  record: RunRecord
): Promise<RefreshedRunResults> {
  record.expectedQuestions = expectedQuestionCount(record.args);
  record.totalEvaluations = expectedEvaluationCount(record.args);
  if (!existsSync(record.resultsDir)) {
    return { hasValidParquet: false, accuracy: null };
  }
  record.completedQuestions = 0;
  record.skippedQuestions = 0;
  record.qualityScore = null;
  const parquetFiles = readdirSync(record.resultsDir)
    .filter((name) => name.endsWith(".parquet"))
    .sort();
  const filename = parquetFiles.at(-1);
  if (filename === undefined) {
    return { hasValidParquet: false, accuracy: null };
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
      return { hasValidParquet: true, accuracy: summary.accuracy };
    }
  } catch (error) {
    wLog("Failed to read run question counts from Parquet", {
      id: record.id,
      error: String(error),
    });
  }
  return { hasValidParquet: false, accuracy: null };
}

export function resolveFinishedRunStatus(input: {
  readonly failedForMetadata: boolean;
  readonly cancelRequested: boolean;
  readonly exitCode: number | null;
  readonly hasCompleteParquet: boolean;
}): RunStatus {
  if (input.failedForMetadata) {
    return "failed";
  }
  if (input.cancelRequested) {
    return "cancelled";
  }
  return input.exitCode === 0 || input.hasCompleteParquet
    ? "succeeded"
    : "failed";
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

function removeUploadedLocalArtifacts(record: RunRecord): void {
  for (const path of [
    join(record.root, "logs"),
    join(record.root, "requests"),
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
        await finishRun(record, null);
        continue;
      }
      if (record.status !== "running" && record.uploadStatus !== "complete") {
        const refreshed = await refreshQuestionCounts(record);
        const hasCompleteParquet =
          refreshed.hasValidParquet &&
          record.totalEvaluations > 0 &&
          record.completedEvaluations === record.totalEvaluations &&
          record.skippedEvaluations === 0;
        if (record.status === "failed" && hasCompleteParquet) {
          record.status = "succeeded";
        }
        record.qualityScore =
          record.status === "succeeded" ? refreshed.accuracy : null;
      }
      await syncMetadata(record);
      if (record.status === "running") {
        watchRecoveredRun(record);
        watchRunProgress(record);
      } else if (record.uploadStatus !== "complete") {
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
    ...(inference.maxTokens !== undefined && {
      maxTokens: inference.maxTokens,
    }),
    ...(inference.reasoningEffort !== undefined && {
      reasoningEffort: inference.reasoningEffort,
    }),
    ...(inference.timeoutMs !== undefined && {
      timeoutMs: inference.timeoutMs,
    }),
    ...(inference.endpointId !== undefined && {
      endpointId: inference.endpointId,
    }),
    ...(inference.costTier !== undefined && { costTier: inference.costTier }),
    ...(inference.sort !== undefined && { sort: inference.sort }),
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
  };
  argv.push("--solver-config", JSON.stringify(solverConfig));
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
  resultsDir: string
): Record<string, string | undefined> {
  const excluded = new Set([
    "BENCH_API_TOKEN",
    "BENCH_RUN_TRIGGER_SECRET",
    "REQUEST_LOG",
    "REQUEST_LOG_FILE",
    "REQUEST_LOG_CONSOLE",
    "SPACES_ACCESS_KEY_ID",
    "SPACES_SECRET_ACCESS_KEY",
    "TAU_AIRLINE_USER_SIMULATOR_API_KEY",
    "TAU_AIRLINE_USER_SIMULATOR_BASE_URL",
    "TAU_AIRLINE_USER_SIMULATOR_MODEL",
  ]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !excluded.has(name) &&
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
      TAU_AIRLINE_USER_SIMULATOR_API_KEY:
        process.env["TAU_AIRLINE_USER_SIMULATOR_API_KEY"],
      TAU_AIRLINE_USER_SIMULATOR_BASE_URL:
        process.env["TAU_AIRLINE_USER_SIMULATOR_BASE_URL"],
      TAU_AIRLINE_USER_SIMULATOR_MODEL:
        process.env["TAU_AIRLINE_USER_SIMULATOR_MODEL"],
    }),
    ...(args.logLevel !== undefined && { LOG_LEVEL: args.logLevel }),
  };
}

function failForMetadata(record: RunRecord, error: unknown): void {
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
  record.uploadError = `MySQL metadata write failed: ${String(error)}`;
  persist(record);
  wLog("Benchmark run failed because MySQL metadata could not be written", {
    id: record.id,
    error: String(error),
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
      });
    } catch (error) {
      record.uploadStatus = "failed";
      record.uploadError = String(error);
      persist(record);
      try {
        await syncMetadata(record);
      } catch (metadataError) {
        failForMetadata(record, metadataError);
      }
      wLog("Benchmark run artifact upload failed", {
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
  record.totalEvaluations = parsed.total;
  record.completedEvaluations = parsed.completed;
  record.skippedEvaluations = skipped;
  record.completionPercentage = parsed.percentage;
  persist(record);
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
  const failedForMetadata = record.uploadError?.startsWith(
    "MySQL metadata write failed:"
  );
  record.exitCode = exitCode;
  record.finishedAt = new Date().toISOString();
  const refreshed = await refreshQuestionCounts(record);
  const hasCompleteParquet =
    refreshed.hasValidParquet &&
    record.totalEvaluations > 0 &&
    record.completedEvaluations === record.totalEvaluations &&
    record.skippedEvaluations === 0;
  record.status = resolveFinishedRunStatus({
    failedForMetadata: Boolean(failedForMetadata),
    cancelRequested: record.cancelRequestedAt !== null,
    exitCode,
    hasCompleteParquet,
  });
  record.qualityScore =
    record.status === "succeeded" ? refreshed.accuracy : null;
  if (record.status === "succeeded") {
    record.completionPercentage = 100;
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
  });
  scheduleUpload(record);
}

function watchRecoveredRun(record: RunRecord): void {
  const timer = setInterval(() => {
    if (record.status !== "running" || isAlive(record.pid)) {
      return;
    }
    clearInterval(timer);
    void finishRun(record, null);
  }, 5000);
  timer.unref();
}

export async function startRun(
  args: RunArgs,
  options: {
    readonly apiKey: string;
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
        resultsDir
      ),
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
    });
  } catch (error) {
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    record.uploadError = `Failed to start benchmark process: ${String(error)}`;
    persist(record);
    await syncMetadata(record);
    throw error;
  } finally {
    closeSync(fd);
  }
  record.pid = child.pid;
  persist(record);
  iLog("Benchmark run started", { id, pid: child.pid, argv: argv.join(" ") });
  watchRunProgress(record);

  void child.exited.then((exitCode) => {
    void finishRun(record, exitCode);
  });

  return record;
}

export function listRuns(): readonly RunRecord[] {
  return [...records.values()].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt)
  );
}

export function getRun(id: string): RunRecord | undefined {
  return records.get(id);
}

export async function listRunMetadata(): Promise<readonly RunMetadata[]> {
  return requiredMetadataStore().list();
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
  persist(record);
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
