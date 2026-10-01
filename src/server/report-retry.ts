import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

import { asyncBufferFromBytes, readResultRows } from "../results/parquet";
import { buildGpqaReport } from "./gpqa-report";
import { buildArgv, childEnvironment } from "./run-registry";
import type { RunArgs } from "./run-registry";
import { buildTauAirlineReport } from "./tau-airline-report";

const DIAGNOSTIC_RETRIES_DIR = "logs/diagnostic-retries";
const MAX_ACTIVE_DIAGNOSTIC_RETRIES = 3;
const MAX_RETAINED_DIAGNOSTIC_RETRIES = 100;
const ERROR_LOG_TAIL_CHARACTERS = 10_000;

export type ReportRetryStatus = "running" | "succeeded" | "failed";

export interface ReportRetryJob {
  readonly id: string;
  readonly runId: string;
  readonly benchmark: RunArgs["benchmark"];
  readonly sampleId: string;
  readonly originalEpoch: number;
  readonly status: ReportRetryStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly result: unknown;
  readonly error: string | null;
}

interface InternalReportRetryJob {
  id: string;
  runId: string;
  benchmark: RunArgs["benchmark"];
  sampleId: string;
  originalEpoch: number;
  status: ReportRetryStatus;
  startedAt: string;
  finishedAt: string | null;
  result: unknown;
  error: string | null;
}

export class ReportRetryLimitError extends Error {
  override readonly name = "ReportRetryLimitError";
}

export function supportsReportRetry(
  benchmark: RunArgs["benchmark"]
): benchmark is "gpqa_diamond" | "tau_bench_verified_airline" {
  return (
    benchmark === "gpqa_diamond" || benchmark === "tau_bench_verified_airline"
  );
}

const jobs = new Map<string, InternalReportRetryJob>();

function publicJob(job: InternalReportRetryJob): ReportRetryJob {
  return {
    id: job.id,
    runId: job.runId,
    benchmark: job.benchmark,
    sampleId: job.sampleId,
    originalEpoch: job.originalEpoch,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
  };
}

function activeRetryCount(): number {
  return [...jobs.values()].filter(({ status }) => status === "running").length;
}

function pruneJobs(): void {
  const terminal = [...jobs.values()]
    .filter(({ status }) => status !== "running")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const removeCount = Math.max(0, jobs.size - MAX_RETAINED_DIAGNOSTIC_RETRIES);
  for (const job of terminal.slice(0, removeCount)) {
    jobs.delete(job.id);
  }
}

function logTail(path: string): string {
  try {
    const content = readFileSync(path, "utf8");
    return content.slice(-ERROR_LOG_TAIL_CHARACTERS).trim();
  } catch {
    return "";
  }
}

async function resultFor(
  job: InternalReportRetryJob,
  resultsDir: string
): Promise<unknown> {
  const parquetFile = readdirSync(resultsDir)
    .filter((file) => file.endsWith(".parquet"))
    .sort()
    .at(-1);
  if (parquetFile === undefined) {
    throw new Error("Diagnostic retry completed without a Parquet result");
  }
  const bytes = new Uint8Array(readFileSync(join(resultsDir, parquetFile)));
  const rows = await readResultRows(asyncBufferFromBytes(bytes));
  if (job.benchmark === "gpqa_diamond") {
    const report = buildGpqaReport(rows);
    const item = report?.items.find(
      ({ sampleId }) => sampleId === job.sampleId
    );
    if (item === undefined) {
      throw new Error(`GPQA retry result missing sample ${job.sampleId}`);
    }
    return item;
  }
  if (job.benchmark === "tau_bench_verified_airline") {
    const report = buildTauAirlineReport(rows);
    const item = report?.items.find(
      ({ sampleId }) => sampleId === job.sampleId
    );
    if (item === undefined) {
      throw new Error(`TAU retry result missing sample ${job.sampleId}`);
    }
    return item;
  }
  throw new Error(`Diagnostic retries are not supported for ${job.benchmark}`);
}

function completeWithError(
  job: InternalReportRetryJob,
  message: string,
  logPath: string
): void {
  const tail = logTail(logPath);
  job.status = "failed";
  job.finishedAt = new Date().toISOString();
  job.error = tail.length > 0 ? `${message}\n\n${tail}` : message;
}

export function diagnosticRetryRunArgs(args: RunArgs): RunArgs {
  return {
    ...args,
    execution: {
      epochs: 1,
      concurrency: 1,
      unordered: false,
      ...(args.execution.maxRetries !== undefined && {
        maxRetries: args.execution.maxRetries,
      }),
    },
  };
}

export function diagnosticRetryArgv(
  args: RunArgs,
  sampleId: string
): readonly string[] {
  return [...buildArgv(diagnosticRetryRunArgs(args)), "--sample-id", sampleId];
}

export function startReportRetry(input: {
  readonly runId: string;
  readonly args: RunArgs;
  readonly sampleId: string;
  readonly originalEpoch: number;
  readonly apiKey: string;
  readonly simulatorApiKey?: string;
}): ReportRetryJob {
  if (!supportsReportRetry(input.args.benchmark)) {
    throw new Error(
      `Diagnostic retries are not supported for ${input.args.benchmark}`
    );
  }
  if (activeRetryCount() >= MAX_ACTIVE_DIAGNOSTIC_RETRIES) {
    throw new ReportRetryLimitError(
      `At most ${MAX_ACTIVE_DIAGNOSTIC_RETRIES} diagnostic retries can run at once`
    );
  }
  pruneJobs();
  const id = randomUUID();
  const root = join(DIAGNOSTIC_RETRIES_DIR, id);
  const logsDir = join(root, "logs");
  const requestsDir = join(root, "requests");
  const resultsDir = join(root, "results");
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(requestsDir, { recursive: true });
  mkdirSync(resultsDir, { recursive: true });
  const logPath = join(logsDir, "run.log");
  const requestLogPath = join(requestsDir, "requests.jsonl");
  const job: InternalReportRetryJob = {
    id,
    runId: input.runId,
    benchmark: input.args.benchmark,
    sampleId: input.sampleId,
    originalEpoch: input.originalEpoch,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  jobs.set(id, job);

  const retryArgs = diagnosticRetryRunArgs(input.args);
  const argv = diagnosticRetryArgv(input.args, input.sampleId);
  const descriptor = openSync(logPath, "a");
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn({
      cmd: [process.execPath, "src/cli/index.ts", ...argv],
      cwd: process.cwd(),
      env: childEnvironment(
        retryArgs,
        input.apiKey,
        id,
        requestLogPath,
        resultsDir,
        input.simulatorApiKey
      ),
      stdin: "ignore",
      stdout: descriptor,
      stderr: descriptor,
    });
  } catch (error) {
    completeWithError(
      job,
      `Failed to start diagnostic retry: ${error}`,
      logPath
    );
    return publicJob(job);
  } finally {
    closeSync(descriptor);
  }

  void child.exited
    .then(async (exitCode) => {
      if (exitCode !== 0) {
        completeWithError(
          job,
          `Diagnostic retry process exited with code ${exitCode}`,
          logPath
        );
        return;
      }
      try {
        job.result = await resultFor(job, resultsDir);
        job.status = "succeeded";
        job.finishedAt = new Date().toISOString();
      } catch (error) {
        completeWithError(
          job,
          `Failed to read diagnostic retry result: ${error}`,
          logPath
        );
      }
    })
    .catch((error) => {
      completeWithError(
        job,
        `Failed while observing diagnostic retry: ${error}`,
        logPath
      );
    });

  return publicJob(job);
}

export function getReportRetry(
  runId: string,
  retryId: string
): ReportRetryJob | undefined {
  const job = jobs.get(retryId);
  return job?.runId === runId ? publicJob(job) : undefined;
}

export function resetReportRetriesForTests(): void {
  jobs.clear();
}
