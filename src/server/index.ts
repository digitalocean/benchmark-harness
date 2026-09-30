#!/usr/bin/env bun
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

import { COST_TIERS, REASONING_EFFORTS } from "../harness/constants";
import { Either } from "../internal/either";
import { ProviderSort } from "../internal/enums";
import { iLog } from "../internal/log";
import { initializeMysql, mysqlConfigFromEnv } from "../internal/mysql";
import { makeSpacesClient, spacesConfigFromEnv } from "../internal/spaces";
import { firstZodIssueMessage, parseSchema, z } from "../internal/zod";
import { asyncBufferFromBytes, readResultRows } from "../results/parquet";
import { DASHBOARD_HTML } from "./dashboard-html";
import { buildGpqaAnalytics } from "./gpqa-analytics";
import { buildGpqaReport, GpqaReportSchema } from "./gpqa-report";
import type { GpqaReport } from "./gpqa-report";
import {
  archiveGpqaRetryCampaignReport,
  cancelGpqaRetryCampaign,
  configureGpqaRetryCampaignStore,
  getGpqaRetryCampaign,
  gpqaFailureBands,
  listPendingGpqaRetryCampaigns,
  listGpqaRetryCampaigns,
  reconcileGpqaRetryCampaigns,
  startGpqaRetryCampaign,
} from "./gpqa-retry-campaign";
import { buildGpqaRetryCampaignReport } from "./gpqa-retry-report";
import {
  GpqaRetryCampaignStoreError,
  makeGpqaRetryCampaignStore,
} from "./gpqa-retry-store";
import {
  isDigitalOceanInferenceBaseUrl,
  isOpenRouterInferenceBaseUrl,
  makeModelCatalogClient,
  ModelCatalogError,
} from "./model-catalog";
import type { ModelCatalogClient } from "./model-catalog";
import {
  getReportRetry,
  ReportRetryLimitError,
  startReportRetry,
  supportsReportRetry,
} from "./report-retry";
import {
  configureRunArtifactClient,
  describeRemoteRunParquet,
  readRemotePrecomputedGpqaReport,
  readRemoteRunParquet,
  remoteRunArtifactResponse,
  remoteRunLogTailResponse,
} from "./run-artifact-read";
import {
  makeRunMetadataStore,
  RunMetadataStoreError,
} from "./run-metadata-store";
import type { RunMetadata } from "./run-metadata-store";
import {
  configureRunPerformanceReportStore,
  getStoredRunPerformanceReport,
  gpqaReportArtifactPath,
} from "./run-performance-report";
import {
  makeRunPerformanceReportStore,
  RunPerformanceReportStoreError,
} from "./run-performance-report-store";
import type { StoredRunPerformanceReport } from "./run-performance-report-store";
import {
  ActiveRunLimitError,
  activeRunCount,
  cancelRun,
  configureRunMetadataStore,
  getRun,
  getRunMetadata,
  listRuns,
  listRunMetadata,
  loadPersistedRuns,
  readTail,
  setRunDisabled,
  startRun,
} from "./run-registry";
import type { RunArgs, RunInference, RunRecord } from "./run-registry";
import { summarizeRunRows } from "./run-summary";
import { buildTauAirlineReport } from "./tau-airline-report";

const DEFAULT_PORT = 8080;
const MAX_ACTIVE_RUNS = 8;
const DEFAULT_BENCHMARK = "gpqa_diamond";
const SUPPORTED_API_BENCHMARKS = [
  "gpqa_diamond",
  "tau_bench_verified_airline",
  "deep_swe",
  "swe_bench_verified",
  "terminal_bench",
  "swe_atlas_qa",
  "swe_atlas_tw",
  "swe_atlas_rf",
] as const;
const DEFAULT_EPOCHS = 3;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_REASONING_EFFORT = "high";
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_COMPLETION_TIMEOUT_MS = 3_600_000;
const FULL_SUITE_SIZES: Readonly<Record<RunArgs["benchmark"], number>> = {
  gpqa_diamond: 198,
  tau_bench_verified_airline: 50,
  deep_swe: 113,
  swe_bench_verified: 500,
  terminal_bench: 89,
  swe_atlas_qa: 124,
  swe_atlas_tw: 90,
  swe_atlas_rf: 65,
};

const IDENTIFIER = /^[A-Za-z0-9._:\-/]+$/;
const DIGITALOCEAN_EMAIL = /@digitalocean\.com$/i;
const MAX_SANDBOX_CONCURRENCY = 6;
let modelCatalogClient: ModelCatalogClient = makeModelCatalogClient();

export function configureModelCatalogClient(
  client: ModelCatalogClient | undefined
): void {
  modelCatalogClient = client ?? makeModelCatalogClient();
}

const InferenceOptionsSchema = z.object({
  baseUrl: z.url(),
  model: z.string().min(1).regex(IDENTIFIER),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  timeoutMs: z.number().int().positive().optional(),
  completionTimeoutMs: z.number().int().positive().optional(),
  endpointId: z.string().min(1).optional(),
  costTier: z.enum(COST_TIERS).optional(),
  sort: z.nativeEnum(ProviderSort).optional(),
  providerOnly: z.array(z.string().min(1)).min(1).optional(),
  allowFallbacks: z.boolean().optional(),
  cloudflareVersion: z.string().min(1).optional(),
  costQualityTradeoff: z.number().int().min(0).max(10).optional(),
  pinModel: z.boolean().optional(),
});
const InferenceRequestSchema = InferenceOptionsSchema.extend({
  apiKey: z.string().min(1),
});

const ExecutionRequestSchema = z.object({
  epochs: z.number().int().positive().max(20).optional(),
  concurrency: z.number().int().positive().max(64).optional(),
  unordered: z.boolean().optional(),
  limit: z.number().int().positive().max(1_000).optional(),
  start: z.number().int().min(0).max(999).optional(),
  end: z.number().int().positive().max(1_000).optional(),
  maxRetries: z.number().int().min(0).max(20).optional(),
});

function usesSandboxWorkers(benchmark: RunArgs["benchmark"]): boolean {
  return (
    benchmark === "deep_swe" ||
    benchmark === "swe_bench_verified" ||
    benchmark === "terminal_bench" ||
    isSweAtlasBenchmark(benchmark)
  );
}

function isSweAtlasBenchmark(benchmark: RunArgs["benchmark"]): boolean {
  return (
    benchmark === "swe_atlas_qa" ||
    benchmark === "swe_atlas_tw" ||
    benchmark === "swe_atlas_rf"
  );
}

export const RunRequestSchema = z
  .object({
    benchmark: z.enum(SUPPORTED_API_BENCHMARKS).default(DEFAULT_BENCHMARK),
    triggeredByEmail: z
      .string()
      .trim()
      .email()
      .regex(DIGITALOCEAN_EMAIL)
      .transform((value) => value.toLowerCase()),
    inference: InferenceRequestSchema,
    execution: ExecutionRequestSchema.default({}),
    judgeModel: z.string().min(1).regex(IDENTIFIER).optional(),
    logLevel: z
      .string()
      .regex(/^-?\d+$/)
      .optional(),
  })
  .superRefine((request, context) => {
    if (
      usesSandboxWorkers(request.benchmark) &&
      (request.execution.concurrency ?? 1) > MAX_SANDBOX_CONCURRENCY
    ) {
      context.addIssue({
        code: "custom",
        path: ["execution", "concurrency"],
        message: `Sandbox benchmark concurrency cannot exceed ${MAX_SANDBOX_CONCURRENCY}`,
      });
    }
  });

const RetryArmSchema = z.object({
  apiKey: z.string().min(1),
  repetitions: z.number().int().positive().max(20).default(1),
  concurrency: z.number().int().positive().max(64).optional(),
  unordered: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(20).optional(),
});

export const GpqaRetryCampaignRequestSchema = z.object({
  selectedFailureCounts: z
    .array(z.number().int().positive().max(20))
    .min(1)
    .max(20),
  triggeredByEmail: z
    .string()
    .trim()
    .email()
    .regex(DIGITALOCEAN_EMAIL)
    .transform((value) => value.toLowerCase()),
  original: RetryArmSchema.extend({
    inference: InferenceOptionsSchema.optional(),
  }),
  comparison: RetryArmSchema.extend({
    inference: InferenceOptionsSchema,
  }).optional(),
});

const DisableRunSchema = z.object({
  disabled: z.boolean().optional(),
});

const ReportRetryRequestSchema = z.object({
  sampleId: z.string().min(1).max(500).regex(IDENTIFIER),
  originalEpoch: z.number().int().nonnegative().max(20),
  apiKey: z.string().min(1),
});

const ReportRetrySourceSchema = z.object({
  items: z.array(
    z.object({
      sampleId: z.string(),
      epoch: z.number().int().nonnegative(),
    })
  ),
});

export function resolveRunRequest(request: z.infer<typeof RunRequestSchema>): {
  readonly apiKey: string;
  readonly args: RunArgs;
} {
  const isSandboxBenchmark = usesSandboxWorkers(request.benchmark);
  const { apiKey, inference } = resolveInferenceRequest(
    request.inference,
    request.benchmark
  );
  return {
    apiKey,
    args: {
      benchmark: request.benchmark,
      triggeredByEmail: request.triggeredByEmail,
      ...(isSweAtlasBenchmark(request.benchmark) &&
        request.judgeModel !== undefined && {
          judgeModel: request.judgeModel,
        }),
      inference,
      execution: {
        ...request.execution,
        epochs:
          request.execution.epochs ?? (isSandboxBenchmark ? 1 : DEFAULT_EPOCHS),
        concurrency:
          request.execution.concurrency ??
          (isSandboxBenchmark ? 1 : DEFAULT_CONCURRENCY),
        maxRetries: request.execution.maxRetries ?? DEFAULT_MAX_RETRIES,
      },
      ...(request.logLevel !== undefined && { logLevel: request.logLevel }),
    },
  };
}

function resolveInferenceRequest(
  request: z.infer<typeof InferenceRequestSchema>,
  benchmark: RunArgs["benchmark"]
): { readonly apiKey: string; readonly inference: RunInference } {
  const { apiKey, ...inference } = request;
  const temperature =
    inference.temperature ?? (benchmark === "gpqa_diamond" ? 1 : 0);
  return {
    apiKey,
    inference: {
      ...inference,
      temperature,
      reasoningEffort: inference.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
      completionTimeoutMs:
        inference.completionTimeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS,
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function authorized(request: Request, token: string): boolean {
  const header = request.headers.get("authorization");
  return header === `Bearer ${token}`;
}

function authorizedRunTrigger(request: Request): boolean {
  const secret = process.env.BENCH_RUN_TRIGGER_SECRET;
  return (
    secret !== undefined &&
    secret.length > 0 &&
    request.headers.get("x-bench-run-secret") === secret
  );
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalNumberParameter(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function paginatedRuns(url: URL): Promise<Record<string, unknown>> {
  const requestedPage = positiveInteger(url.searchParams.get("page"), 1);
  const pageSize = Math.min(
    positiveInteger(url.searchParams.get("pageSize"), 50),
    100
  );
  const benchmark = url.searchParams.get("benchmark");
  const model = (url.searchParams.get("model") ?? "").trim().toLowerCase();
  const modelExact = url.searchParams.get("modelExact") === "1";
  const durationGt = optionalNumberParameter(
    url.searchParams.get("durationGt")
  );
  const triggeredBy = (url.searchParams.get("triggeredBy") ?? "")
    .trim()
    .toLowerCase();
  const status = url.searchParams.get("status");
  const qualityLt = optionalNumberParameter(url.searchParams.get("qualityLt"));
  const hideCanary = url.searchParams.get("hideCanary") === "1";
  const canaryOnly = url.searchParams.get("canaryOnly") === "1";
  const fullSuiteOnly = url.searchParams.get("fullSuiteOnly") === "1";
  const showDisabled = url.searchParams.get("showDisabled") === "1";
  const canaryEmail = "genai-temporal-worker@digitalocean.com";
  const now = Date.now();
  const allRuns = await listRunMetadata();
  const filtered = allRuns.filter((run) => {
    const start = new Date(run.startedAt).getTime();
    const end =
      run.finishedAt === null ? now : new Date(run.finishedAt).getTime();
    const durationSeconds =
      Number.isFinite(start) && Number.isFinite(end)
        ? Math.max(0, end - start) / 1000
        : 0;
    const runModel = run.args.inference.model.toLowerCase();
    const runTriggeredBy = (run.triggeredByEmail ?? "").toLowerCase();
    const modelMatches =
      model === "" ||
      (modelExact ? runModel === model : runModel.includes(model));
    const fullSuiteSize = FULL_SUITE_SIZES[run.args.benchmark];
    const limit = run.args.execution.limit;
    const isPartialLimit = limit !== undefined && limit < fullSuiteSize;
    return (
      (benchmark === null ||
        benchmark === "all" ||
        run.args.benchmark === benchmark) &&
      modelMatches &&
      (durationGt === undefined ||
        durationGt < 0 ||
        durationSeconds > durationGt) &&
      (triggeredBy === "" || runTriggeredBy.includes(triggeredBy)) &&
      (status === null || status === "all" || run.status === status) &&
      (qualityLt === undefined ||
        qualityLt < 0 ||
        (run.qualityScore !== null && run.qualityScore * 100 < qualityLt)) &&
      (!hideCanary || runTriggeredBy !== canaryEmail) &&
      (!canaryOnly || runTriggeredBy === canaryEmail) &&
      (!fullSuiteOnly || !isPartialLimit) &&
      (showDisabled || !run.disabled)
    );
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  return {
    runs: filtered.slice(offset, offset + pageSize),
    page,
    pageSize,
    total,
    totalPages,
    summary: {
      total,
      running: filtered.filter((run) => run.status === "running").length,
      failed: filtered.filter((run) => run.status === "failed").length,
    },
  };
}

export function maxActiveRuns(): number {
  const raw = Number(process.env.BENCH_API_MAX_RUNS);
  return Number.isInteger(raw) && raw > 0
    ? Math.min(raw, MAX_ACTIVE_RUNS)
    : MAX_ACTIVE_RUNS;
}

interface RunResultFile {
  readonly runId: string;
  readonly file: string;
  readonly path: string;
  readonly bytes: number;
  readonly modifiedAt: string;
}

function listRunResults(record: RunRecord): RunResultFile[] {
  if (!existsSync(record.resultsDir)) {
    return [];
  }
  return readdirSync(record.resultsDir)
    .filter((file) => file.endsWith(".parquet"))
    .map((file) => {
      const path = join(record.resultsDir, file);
      const stats = statSync(path);
      return {
        runId: record.id,
        file,
        path,
        bytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function resultPaths(): string[] {
  return listRuns().flatMap((record) =>
    listRunResults(record).map((result) => result.path)
  );
}

function artifactDownloadResponse(
  path: string,
  filename: string,
  contentType: string
): Response {
  if (!existsSync(path)) {
    return json({ error: "artifact not found" }, 404);
  }
  const safeFilename = filename.replaceAll(/[^A-Za-z0-9._-]/gu, "_");
  return new Response(readFileSync(path), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
    },
  });
}

export function requestRecordsResponse(
  record: RunRecord,
  requestedOffset = 0
): Response {
  if (!existsSync(record.requestLogPath)) {
    return json({ error: "request records not found", id: record.id }, 404);
  }
  const bytes = statSync(record.requestLogPath).size;
  const offset =
    Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : 0;
  const reset = offset > bytes;
  const start = reset ? 0 : offset;
  const content = Buffer.alloc(bytes - start);
  const descriptor = openSync(record.requestLogPath, "r");
  let bytesRead = 0;
  try {
    while (bytesRead < content.byteLength) {
      const count = readSync(
        descriptor,
        content,
        bytesRead,
        content.byteLength - bytesRead,
        start + bytesRead
      );
      if (count === 0) {
        break;
      }
      bytesRead += count;
    }
  } finally {
    closeSync(descriptor);
  }
  return new Response(content.subarray(0, bytesRead), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Request-Log-Next-Offset": String(start + bytesRead),
      ...(reset && { "X-Request-Log-Reset": "1" }),
    },
  });
}

export function logDownloadResponse(record: RunRecord): Response {
  return artifactDownloadResponse(
    record.logPath,
    `${record.id}-run.log`,
    "text/plain; charset=utf-8"
  );
}

export function requestRecordsDownloadResponse(record: RunRecord): Response {
  return artifactDownloadResponse(
    record.requestLogPath,
    `${record.id}-requests.jsonl`,
    "application/x-ndjson; charset=utf-8"
  );
}

export function runStateResponse(
  record: RunRecord,
  download = false
): Response {
  const path = join(record.root, "run.json");
  if (download) {
    return artifactDownloadResponse(
      path,
      `${record.id}-run.json`,
      "application/json; charset=utf-8"
    );
  }
  if (!existsSync(path)) {
    return json({ error: "run state not found", id: record.id }, 404);
  }
  return new Response(readFileSync(path), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function parquetResponse(record: RunRecord): Response {
  const result = listRunResults(record)[0];
  if (result === undefined) {
    return json({ error: "parquet result not found", id: record.id }, 404);
  }
  const filename = result.file.replaceAll(/[^A-Za-z0-9._-]/gu, "_");
  return new Response(readFileSync(result.path), {
    headers: {
      "Content-Type": "application/vnd.apache.parquet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function runSummaryResponse(record: RunRecord): Promise<Response> {
  const result = listRunResults(record)[0];
  if (result === undefined) {
    return json({ error: "parquet result not found", id: record.id }, 404);
  }
  try {
    return summarizeParquet(
      record.id,
      result.file,
      new Uint8Array(readFileSync(result.path))
    );
  } catch (error) {
    return json(
      { error: "failed to summarize parquet result", detail: String(error) },
      500
    );
  }
}

function precomputedGpqaReportResponse(
  bytes: Uint8Array,
  runId: string,
  download: boolean
): Response {
  const safeFilename = `${runId}-gpqa-report.json`.replaceAll(
    /[^A-Za-z0-9._-]/gu,
    "_"
  );
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...(download && {
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
      }),
    },
  });
}

function performanceReportApiPayload(
  stored: StoredRunPerformanceReport | undefined
) {
  if (stored === undefined) {
    return null;
  }
  return {
    schemaVersion: stored.schemaVersion,
    computedAt: stored.computedAt,
    status: stored.status,
    error: stored.error,
    report: stored.report,
  };
}

async function runDetailsResponse(metadata: RunMetadata): Promise<Response> {
  let performanceReport: ReturnType<typeof performanceReportApiPayload> = null;
  try {
    performanceReport = performanceReportApiPayload(
      await getStoredRunPerformanceReport(metadata.id)
    );
  } catch (error) {
    if (!(error instanceof RunPerformanceReportStoreError)) {
      throw error;
    }
  }
  return json({
    ...metadata,
    performanceReport,
  });
}

export async function gpqaReportResponse(
  record: RunRecord,
  download = false
): Promise<Response> {
  const precomputedPath = gpqaReportArtifactPath(record);
  if (existsSync(precomputedPath)) {
    return precomputedGpqaReportResponse(
      new Uint8Array(readFileSync(precomputedPath)),
      record.id,
      download
    );
  }
  const result = listRunResults(record)[0];
  if (result === undefined) {
    return json({ error: "parquet result not found", id: record.id }, 404);
  }
  try {
    const response = await createGpqaReportResponse(
      record.id,
      result.file,
      new Uint8Array(readFileSync(result.path)),
      record.args.inference,
      download
    );
    return response;
  } catch (error) {
    return json(
      { error: "failed to build GPQA report", detail: String(error) },
      500
    );
  }
}

export async function tauAirlineReportResponse(
  record: RunRecord,
  download = false
): Promise<Response> {
  const result = listRunResults(record)[0];
  if (result === undefined) {
    return json({ error: "parquet result not found", id: record.id }, 404);
  }
  try {
    const response = await createTauAirlineReportResponse(
      record.id,
      result.file,
      new Uint8Array(readFileSync(result.path)),
      download
    );
    return response;
  } catch (error) {
    return json(
      { error: "failed to build TAU Airline report", detail: String(error) },
      500
    );
  }
}

async function summarizeParquet(
  runId: string,
  file: string,
  bytes: Uint8Array
): Promise<Response> {
  const rows = await readResultRows(asyncBufferFromBytes(bytes));
  const summary = summarizeRunRows(rows);
  return summary === null
    ? json({ error: "parquet result is empty", id: runId }, 422)
    : json({ runId, file, ...summary });
}

async function createGpqaReportResponse(
  runId: string,
  file: string,
  bytes: Uint8Array,
  inference: RunInference,
  download: boolean
): Promise<Response> {
  const rows = await readResultRows(asyncBufferFromBytes(bytes));
  const report = buildGpqaReport(rows);
  if (report === null) {
    return json({ error: "GPQA report data is unavailable", id: runId }, 422);
  }
  const safeFilename = `${runId}-gpqa-report.json`.replaceAll(
    /[^A-Za-z0-9._-]/gu,
    "_"
  );
  return new Response(
    JSON.stringify(
      {
        runId,
        file,
        inference,
        ...report,
        analytics: buildGpqaAnalytics(report.items),
      },
      null,
      2
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        ...(download && {
          "Content-Disposition": `attachment; filename="${safeFilename}"`,
        }),
      },
    }
  );
}

async function createTauAirlineReportResponse(
  runId: string,
  file: string,
  bytes: Uint8Array,
  download: boolean
): Promise<Response> {
  const rows = await readResultRows(asyncBufferFromBytes(bytes));
  const report = buildTauAirlineReport(rows);
  if (report === null) {
    return json(
      { error: "TAU Airline report data is unavailable", id: runId },
      422
    );
  }
  const safeFilename = `${runId}-tau-airline-report.json`.replaceAll(
    /[^A-Za-z0-9._-]/gu,
    "_"
  );
  return new Response(JSON.stringify({ runId, file, ...report }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...(download && {
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
      }),
    },
  });
}

type RemoteRunMetadata = NonNullable<
  Awaited<ReturnType<typeof getRunMetadata>>
> & {
  readonly uploadStatus: "complete";
  readonly spacesBucket: string;
  readonly spacesPrefix: string;
};

function hasRemoteArtifacts(
  metadata: Awaited<ReturnType<typeof getRunMetadata>>
): metadata is RemoteRunMetadata {
  return (
    metadata !== undefined &&
    metadata.uploadStatus === "complete" &&
    metadata.spacesBucket !== null &&
    metadata.spacesPrefix !== null
  );
}

async function listAllRunResults(): Promise<RunResultFile[]> {
  const metadata = await listRunMetadata();
  const remoteMetadata = metadata.filter(hasRemoteArtifacts);
  const described = await Promise.all(
    remoteMetadata.map(describeRemoteRunParquet)
  );
  const remoteResults = described.filter(
    (result): result is RunResultFile => result !== undefined
  );
  const remoteIds = new Set(remoteMetadata.map(({ id }) => id));
  const localResults = listRuns()
    .filter(({ id }) => !remoteIds.has(id))
    .flatMap(listRunResults);
  return [...remoteResults, ...localResults].sort((a, b) =>
    b.modifiedAt.localeCompare(a.modifiedAt)
  );
}

async function remoteSummaryResponse(
  metadata: NonNullable<Awaited<ReturnType<typeof getRunMetadata>>>
): Promise<Response> {
  try {
    const result = await readRemoteRunParquet(metadata);
    return result === undefined
      ? json({ error: "parquet result not found", id: metadata.id }, 404)
      : await summarizeParquet(metadata.id, result.file, result.bytes);
  } catch (error) {
    return json(
      { error: "failed to summarize parquet result", detail: String(error) },
      500
    );
  }
}

async function remoteGpqaReportResponse(
  metadata: NonNullable<Awaited<ReturnType<typeof getRunMetadata>>>,
  download: boolean
): Promise<Response> {
  try {
    const precomputed = await readRemotePrecomputedGpqaReport(metadata);
    if (precomputed !== undefined) {
      return precomputedGpqaReportResponse(precomputed, metadata.id, download);
    }
    const result = await readRemoteRunParquet(metadata);
    return result === undefined
      ? json({ error: "parquet result not found", id: metadata.id }, 404)
      : await createGpqaReportResponse(
          metadata.id,
          result.file,
          result.bytes,
          metadata.args.inference,
          download
        );
  } catch (error) {
    return json(
      { error: "failed to build GPQA report", detail: String(error) },
      500
    );
  }
}

async function remoteTauAirlineReportResponse(
  metadata: NonNullable<Awaited<ReturnType<typeof getRunMetadata>>>,
  download: boolean
): Promise<Response> {
  try {
    const result = await readRemoteRunParquet(metadata);
    return result === undefined
      ? json({ error: "parquet result not found", id: metadata.id }, 404)
      : await createTauAirlineReportResponse(
          metadata.id,
          result.file,
          result.bytes,
          download
        );
  } catch (error) {
    return json(
      { error: "failed to build TAU Airline report", detail: String(error) },
      500
    );
  }
}

async function generateSummary(): Promise<Response> {
  const paths = resultPaths();
  if (paths.length === 0) {
    return json({ error: "no parquet results found" }, 404);
  }
  const child = Bun.spawn({
    cmd: [process.execPath, "tools/summary.ts", ...paths],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [markdown, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    return json({ error: "summary failed", detail: stderr.trim() }, 500);
  }
  return new Response(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

function tailParam(url: URL, fallback: number): number {
  const raw = Number(url.searchParams.get("tail"));
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 10_000) : fallback;
}

async function handleCreateRun(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = parseSchema(RunRequestSchema, body);
  if (Either.isLeft(parsed)) {
    return json({ error: firstZodIssueMessage(parsed.left) }, 400);
  }
  const { apiKey, args } = resolveRunRequest(parsed.right);
  const rangeError = validateRange(args);
  if (rangeError !== null) {
    return json({ error: rangeError }, 400);
  }
  try {
    return json(
      await startRun(args, {
        apiKey,
        maxActiveRuns: maxActiveRuns(),
      }),
      202
    );
  } catch (error) {
    if (error instanceof ActiveRunLimitError) {
      return json(
        {
          error: error.message,
          active: activeRunCount(),
          max: maxActiveRuns(),
        },
        429
      );
    }
    if (error instanceof RunMetadataStoreError) {
      return json({ error: error.message }, 503);
    }
    throw error;
  }
}

async function reportRetrySourceResponse(
  metadata: NonNullable<Awaited<ReturnType<typeof getRunMetadata>>>,
  localRecord: RunRecord | undefined
): Promise<Response | undefined> {
  if (hasRemoteArtifacts(metadata)) {
    if (metadata.args.benchmark === "gpqa_diamond") {
      return remoteGpqaReportResponse(metadata, false);
    }
    return metadata.args.benchmark === "tau_bench_verified_airline"
      ? remoteTauAirlineReportResponse(metadata, false)
      : undefined;
  }
  if (localRecord === undefined) {
    return undefined;
  }
  if (metadata.args.benchmark === "gpqa_diamond") {
    return gpqaReportResponse(localRecord);
  }
  return metadata.args.benchmark === "tau_bench_verified_airline"
    ? tauAirlineReportResponse(localRecord)
    : undefined;
}

async function gpqaReportForRun(
  runId: string
): Promise<GpqaReport | undefined> {
  const metadata = await getRunMetadata(runId);
  if (metadata === undefined || metadata.args.benchmark !== "gpqa_diamond") {
    return undefined;
  }
  const response = await reportRetrySourceResponse(metadata, getRun(runId));
  if (response === undefined || !response.ok) {
    return undefined;
  }
  const parsed = parseSchema(GpqaReportSchema, await response.json());
  return Either.isLeft(parsed) ? undefined : parsed.right;
}

async function gpqaRetryCampaignReportResponse(
  sourceRunId: string,
  campaignId: string,
  download: boolean
): Promise<Response> {
  const campaign = await getGpqaRetryCampaign(sourceRunId, campaignId);
  if (campaign === undefined) {
    return json(
      { error: "GPQA retry comparison not found", id: campaignId },
      404
    );
  }
  if (campaign.originalRunId === null) {
    return json({ error: "Original retry arm has not started" }, 409);
  }
  const report = await finalizeGpqaRetryCampaign(campaign);
  if (report === undefined) {
    return json(
      {
        error: "Retry comparison report is not available yet",
        comparison: campaign,
      },
      409
    );
  }
  return new Response(JSON.stringify(report, null, 2), {
    headers: {
      "Content-Type": "application/json",
      ...(download && {
        "Content-Disposition": `attachment; filename="${campaignId}-gpqa-retry-report.json"`,
      }),
    },
  });
}

async function finalizeGpqaRetryCampaign(
  campaign: NonNullable<Awaited<ReturnType<typeof getGpqaRetryCampaign>>>
): Promise<ReturnType<typeof buildGpqaRetryCampaignReport> | undefined> {
  if (campaign.originalRunId === null) {
    return undefined;
  }
  const [source, original, comparison] = await Promise.all([
    gpqaReportForRun(campaign.sourceRunId),
    gpqaReportForRun(campaign.originalRunId),
    campaign.comparisonRunId === null
      ? Promise.resolve(undefined)
      : gpqaReportForRun(campaign.comparisonRunId),
  ]);
  if (source === undefined) {
    return undefined;
  }
  const report = buildGpqaRetryCampaignReport({
    campaign,
    source,
    ...(original !== undefined && { original }),
    ...(comparison !== undefined && { comparison }),
  });
  const allArmsComplete =
    original !== undefined &&
    (campaign.comparisonRunId === null || comparison !== undefined);
  if (allArmsComplete && campaign.status !== "running") {
    await archiveGpqaRetryCampaignReport(campaign, report);
  }
  return report;
}

async function campaignWithArms(
  campaign: NonNullable<Awaited<ReturnType<typeof getGpqaRetryCampaign>>>
): Promise<Record<string, unknown>> {
  if (campaign.status !== "running" && campaign.uploadStatus !== "complete") {
    await finalizeGpqaRetryCampaign(campaign);
  }
  const [originalRun, comparisonRun] = await Promise.all([
    campaign.originalRunId === null
      ? Promise.resolve(undefined)
      : getRunMetadata(campaign.originalRunId),
    campaign.comparisonRunId === null
      ? Promise.resolve(undefined)
      : getRunMetadata(campaign.comparisonRunId),
  ]);
  return { ...campaign, originalRun, comparisonRun };
}

export function validateRange(args: RunArgs): string | null {
  const { end, limit, start } = args.execution;
  if (limit !== undefined && end !== undefined) {
    return "execution.limit and execution.end are mutually exclusive";
  }
  if (end !== undefined && end <= (start ?? 0)) {
    return "execution.end must be greater than execution.start";
  }
  return null;
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/gpqa-benchmarks" && request.method === "GET") {
    return html(DASHBOARD_HTML);
  }
  if (pathname === "/" && request.method === "GET") {
    return json({ error: "not found", path: pathname }, 404);
  }
  if (pathname === "/health") {
    return json({ ok: true, activeRuns: activeRunCount() });
  }

  const token = process.env.BENCH_API_TOKEN;
  if (token === undefined || !authorized(request, token)) {
    return json({ error: "unauthorized" }, 401);
  }

  if (pathname === "/runs" && request.method === "POST") {
    if (!authorizedRunTrigger(request)) {
      return json({ error: "invalid run trigger password" }, 403);
    }
    return handleCreateRun(request);
  }
  if (pathname === "/runs" && request.method === "GET") {
    return url.searchParams.get("view") === "page"
      ? json(await paginatedRuns(url))
      : json(await listRunMetadata());
  }
  if (pathname === "/model-catalog" && request.method === "GET") {
    const baseUrl = url.searchParams.get("baseUrl");
    if (
      baseUrl === null ||
      (!isDigitalOceanInferenceBaseUrl(baseUrl) &&
        !isOpenRouterInferenceBaseUrl(baseUrl))
    ) {
      return json(
        {
          error:
            "baseUrl must be a supported DigitalOcean or OpenRouter inference endpoint",
        },
        400
      );
    }
    try {
      const models = isOpenRouterInferenceBaseUrl(baseUrl)
        ? await modelCatalogClient.listOpenRouterModels()
        : await modelCatalogClient.listDigitalOceanModels();
      return json({
        baseUrl,
        models,
      });
    } catch (error) {
      if (error instanceof ModelCatalogError) {
        return json({ error: error.message }, 503);
      }
      throw error;
    }
  }
  if (pathname === "/results" && request.method === "GET") {
    return json(await listAllRunResults());
  }
  if (pathname === "/summary" && request.method === "GET") {
    return generateSummary();
  }

  const gpqaRetryCampaignMatch =
    /^\/runs\/([^/]+)\/gpqa-retry-(?:comparisons|campaigns)(?:\/([^/]+))?(\/report|\/cancel)?$/.exec(
      pathname
    );
  if (gpqaRetryCampaignMatch !== null) {
    const sourceRunId = gpqaRetryCampaignMatch[1] ?? "";
    const campaignId = gpqaRetryCampaignMatch[2];
    const action = gpqaRetryCampaignMatch[3];
    const sourceMetadata = await getRunMetadata(sourceRunId);
    if (
      sourceMetadata === undefined ||
      sourceMetadata.args.benchmark !== "gpqa_diamond"
    ) {
      return json({ error: "GPQA source run not found", id: sourceRunId }, 404);
    }
    if (
      campaignId === undefined &&
      action === undefined &&
      request.method === "POST" &&
      !authorizedRunTrigger(request)
    ) {
      return json({ error: "invalid run trigger password" }, 403);
    }
    if (
      campaignId !== undefined &&
      action === "/report" &&
      request.method === "GET"
    ) {
      return gpqaRetryCampaignReportResponse(
        sourceRunId,
        campaignId,
        url.searchParams.get("download") === "1"
      );
    }
    if (
      campaignId !== undefined &&
      action === "/cancel" &&
      request.method === "POST"
    ) {
      if (!authorizedRunTrigger(request)) {
        return json({ error: "invalid run trigger password" }, 403);
      }
      const campaign = await cancelGpqaRetryCampaign(sourceRunId, campaignId);
      return campaign === undefined
        ? json({ error: "GPQA retry comparison not found" }, 404)
        : json(campaign);
    }
    if (
      campaignId !== undefined &&
      action === undefined &&
      request.method === "GET"
    ) {
      const campaign = await getGpqaRetryCampaign(sourceRunId, campaignId);
      return campaign === undefined
        ? json({ error: "GPQA retry comparison not found" }, 404)
        : json(await campaignWithArms(campaign));
    }
    const sourceReport = await gpqaReportForRun(sourceRunId);
    if (sourceReport === undefined) {
      return json({ error: "Source GPQA report is unavailable" }, 409);
    }
    const bands = gpqaFailureBands(
      sourceReport.items,
      sourceMetadata.args.execution.epochs
    );
    if (
      campaignId === undefined &&
      action === undefined &&
      request.method === "GET"
    ) {
      const comparisons = await listGpqaRetryCampaigns(sourceRunId);
      return json({
        sourceRunId,
        sourceEpochs: sourceMetadata.args.execution.epochs,
        sourceInference: sourceMetadata.args.inference,
        sourceExecution: sourceMetadata.args.execution,
        bands,
        comparisons: await Promise.all(comparisons.map(campaignWithArms)),
      });
    }
    if (
      campaignId === undefined &&
      action === undefined &&
      request.method === "POST"
    ) {
      const body: unknown = await request.json().catch(() => ({}));
      const parsed = parseSchema(GpqaRetryCampaignRequestSchema, body);
      if (Either.isLeft(parsed)) {
        return json({ error: firstZodIssueMessage(parsed.left) }, 400);
      }
      const availableFailureCounts = new Set(
        bands.map(({ failures }) => failures)
      );
      if (
        parsed.right.selectedFailureCounts.some(
          (failures) => !availableFailureCounts.has(failures)
        )
      ) {
        return json(
          { error: "selectedFailureCounts contains an unavailable band" },
          400
        );
      }
      const comparison =
        parsed.right.comparison === undefined
          ? undefined
          : {
              ...parsed.right.comparison,
              ...resolveInferenceRequest(
                {
                  ...parsed.right.comparison.inference,
                  apiKey: parsed.right.comparison.apiKey,
                },
                "gpqa_diamond"
              ),
            };
      const { inference: originalInference, ...originalWithoutInference } =
        parsed.right.original;
      const original = {
        ...originalWithoutInference,
        ...(originalInference !== undefined && {
          inference: resolveInferenceRequest(
            {
              ...originalInference,
              apiKey: parsed.right.original.apiKey,
            },
            "gpqa_diamond"
          ).inference,
        }),
      };
      try {
        return json(
          await startGpqaRetryCampaign({
            sourceRunId,
            sourceArgs: sourceMetadata.args,
            sourceItems: sourceReport.items,
            selectedFailureCounts: [
              ...new Set(parsed.right.selectedFailureCounts),
            ],
            original,
            ...(comparison !== undefined && { comparison }),
            triggeredByEmail: parsed.right.triggeredByEmail,
            maxActiveRuns: maxActiveRuns(),
          }),
          202
        );
      } catch (error) {
        if (error instanceof ActiveRunLimitError) {
          return json(
            {
              error: error.message,
              active: activeRunCount(),
              max: maxActiveRuns(),
            },
            429
          );
        }
        throw error;
      }
    }
    return json({ error: "method not allowed" }, 405);
  }

  const reportRetryMatch =
    /^\/runs\/([^/]+)\/diagnostic-retries(?:\/([^/]+))?$/.exec(pathname);
  if (reportRetryMatch !== null) {
    const runId = reportRetryMatch[1] ?? "";
    const retryId = reportRetryMatch[2];
    const metadata = await getRunMetadata(runId);
    if (metadata === undefined) {
      return json({ error: "run not found", id: runId }, 404);
    }
    if (retryId !== undefined && request.method === "GET") {
      const retry = getReportRetry(runId, retryId);
      return retry === undefined
        ? json({ error: "diagnostic retry not found", id: retryId }, 404)
        : json(retry);
    }
    if (retryId === undefined && request.method === "POST") {
      if (!authorizedRunTrigger(request)) {
        return json({ error: "invalid run trigger password" }, 403);
      }
      if (!supportsReportRetry(metadata.args.benchmark)) {
        return json(
          {
            error: `diagnostic retries are not supported for ${metadata.args.benchmark}`,
          },
          409
        );
      }
      const body: unknown = await request.json().catch(() => ({}));
      const parsed = parseSchema(ReportRetryRequestSchema, body);
      if (Either.isLeft(parsed)) {
        return json({ error: firstZodIssueMessage(parsed.left) }, 400);
      }
      const localRecord = getRun(runId);
      const reportResponse = await reportRetrySourceResponse(
        metadata,
        localRecord
      );
      if (reportResponse === undefined || !reportResponse.ok) {
        return json(
          { error: "source report is unavailable for diagnostic retry" },
          409
        );
      }
      const sourceReport = parseSchema(
        ReportRetrySourceSchema,
        await reportResponse.json()
      );
      if (Either.isLeft(sourceReport)) {
        return json({ error: "source report is invalid" }, 500);
      }
      const sourceItemExists = sourceReport.right.items.some(
        (item) =>
          item.sampleId === parsed.right.sampleId &&
          item.epoch === parsed.right.originalEpoch
      );
      if (!sourceItemExists) {
        return json(
          {
            error: "report item not found",
            sampleId: parsed.right.sampleId,
            epoch: parsed.right.originalEpoch,
          },
          404
        );
      }
      try {
        return json(
          startReportRetry({
            runId,
            args: metadata.args,
            sampleId: parsed.right.sampleId,
            originalEpoch: parsed.right.originalEpoch,
            apiKey: parsed.right.apiKey,
          }),
          202
        );
      } catch (error) {
        if (error instanceof ReportRetryLimitError) {
          return json({ error: error.message }, 429);
        }
        throw error;
      }
    }
    return json({ error: "method not allowed" }, 405);
  }

  const runMatch =
    /^\/runs\/([^/]+)(\/logs|\/state|\/request-records|\/results|\/parquet|\/summary|\/gpqa-report|\/tau-airline-report|\/cancel|\/disable)?$/.exec(
      pathname
    );
  if (runMatch !== null) {
    const id = runMatch[1] ?? "";
    const suffix = runMatch[2];
    const metadata = await getRunMetadata(id);
    if (metadata === undefined) {
      return json({ error: "run not found", id }, 404);
    }
    if (suffix === undefined && request.method === "GET") {
      return runDetailsResponse(metadata);
    }
    if (
      suffix === "/gpqa-report" &&
      metadata.args.benchmark !== "gpqa_diamond"
    ) {
      return json(
        { error: "GPQA report is only available for GPQA runs", id },
        404
      );
    }
    if (
      suffix === "/tau-airline-report" &&
      metadata.args.benchmark !== "tau_bench_verified_airline"
    ) {
      return json(
        {
          error: "TAU Airline report is only available for TAU Airline runs",
          id,
        },
        404
      );
    }
    if (hasRemoteArtifacts(metadata) && request.method === "GET") {
      if (suffix === "/logs") {
        const response =
          url.searchParams.get("download") === "1"
            ? await remoteRunArtifactResponse(metadata, "logs", true)
            : await remoteRunLogTailResponse(metadata, tailParam(url, 200));
        return (
          response ??
          json({ error: "log artifact not found", id: metadata.id }, 404)
        );
      }
      if (suffix === "/state") {
        const response = await remoteRunArtifactResponse(
          metadata,
          "state",
          url.searchParams.get("download") === "1"
        );
        return (
          response ??
          json({ error: "run state artifact not found", id: metadata.id }, 404)
        );
      }
      if (suffix === "/request-records") {
        const response = await remoteRunArtifactResponse(
          metadata,
          "requests",
          url.searchParams.get("download") === "1"
        );
        return (
          response ??
          json({ error: "request records not found", id: metadata.id }, 404)
        );
      }
      if (suffix === "/parquet") {
        const response = await remoteRunArtifactResponse(
          metadata,
          "parquet",
          true
        );
        return (
          response ??
          json({ error: "parquet result not found", id: metadata.id }, 404)
        );
      }
      if (suffix === "/summary") {
        return remoteSummaryResponse(metadata);
      }
      if (suffix === "/gpqa-report") {
        return remoteGpqaReportResponse(
          metadata,
          url.searchParams.get("download") === "1"
        );
      }
      if (suffix === "/tau-airline-report") {
        return remoteTauAirlineReportResponse(
          metadata,
          url.searchParams.get("download") === "1"
        );
      }
    }
    if (suffix === "/disable" && request.method === "POST") {
      const body: unknown = await request.json().catch(() => ({}));
      const parsed = parseSchema(DisableRunSchema, body);
      if (Either.isLeft(parsed)) {
        return json({ error: firstZodIssueMessage(parsed.left) }, 400);
      }
      const updated = await setRunDisabled(id, parsed.right.disabled ?? true);
      return updated === undefined
        ? json({ error: "run not found", id }, 404)
        : json(updated);
    }
    const record = getRun(id);
    if (record === undefined) {
      return json({ error: "run not found", id }, 404);
    }
    if (suffix === "/logs" && request.method === "GET") {
      if (url.searchParams.get("download") === "1") {
        return logDownloadResponse(record);
      }
      return text(readTail(record.logPath, tailParam(url, 200)));
    }
    if (suffix === "/state" && request.method === "GET") {
      return runStateResponse(record, url.searchParams.get("download") === "1");
    }
    if (suffix === "/request-records" && request.method === "GET") {
      return url.searchParams.get("download") === "1"
        ? requestRecordsDownloadResponse(record)
        : requestRecordsResponse(
            record,
            Number(url.searchParams.get("after") ?? "0")
          );
    }
    if (suffix === "/results" && request.method === "GET") {
      return json(listRunResults(record));
    }
    if (suffix === "/parquet" && request.method === "GET") {
      return parquetResponse(record);
    }
    if (suffix === "/summary" && request.method === "GET") {
      return runSummaryResponse(record);
    }
    if (suffix === "/gpqa-report" && request.method === "GET") {
      return gpqaReportResponse(
        record,
        url.searchParams.get("download") === "1"
      );
    }
    if (suffix === "/tau-airline-report" && request.method === "GET") {
      return tauAirlineReportResponse(
        record,
        url.searchParams.get("download") === "1"
      );
    }
    if (suffix === "/cancel" && request.method === "POST") {
      return json(await cancelRun(id));
    }
  }

  return json({ error: "not found", path: pathname }, 404);
}

async function main(): Promise<void> {
  if (process.env.BENCH_API_TOKEN === undefined) {
    throw new Error(
      "Set BENCH_API_TOKEN so the API is not open to the internet"
    );
  }
  if (!process.env.BENCH_RUN_TRIGGER_SECRET?.trim()) {
    throw new Error("Set BENCH_RUN_TRIGGER_SECRET to authorize new runs");
  }
  configureRunArtifactClient(makeSpacesClient(spacesConfigFromEnv()));
  configureModelCatalogClient(undefined);
  const mysql = await initializeMysql(mysqlConfigFromEnv());
  configureRunMetadataStore(makeRunMetadataStore(mysql));
  configureRunPerformanceReportStore(makeRunPerformanceReportStore(mysql));
  configureGpqaRetryCampaignStore(makeGpqaRetryCampaignStore(mysql));
  await loadPersistedRuns();
  await reconcileGpqaRetryCampaigns();
  const pendingCampaigns = await listPendingGpqaRetryCampaigns();
  await Promise.allSettled(
    pendingCampaigns
      .filter(({ status }) => status !== "running")
      .map(finalizeGpqaRetryCampaign)
  );
  const port = Number(process.env.BENCH_API_PORT ?? DEFAULT_PORT);
  const hostname = process.env.BENCH_API_HOST ?? "127.0.0.1";
  const server = Bun.serve({
    port,
    hostname,
    fetch: async (request) => {
      try {
        return await handleRequest(request);
      } catch (error) {
        if (error instanceof RunMetadataStoreError) {
          return json({ error: error.message }, 503);
        }
        if (error instanceof RunPerformanceReportStoreError) {
          return json({ error: error.message }, 503);
        }
        if (error instanceof GpqaRetryCampaignStoreError) {
          return json({ error: error.message }, 503);
        }
        if (error instanceof ModelCatalogError) {
          return json({ error: error.message }, 503);
        }
        throw error;
      }
    },
  });
  iLog("Benchmark API listening", {
    url: `http://${server.hostname}:${server.port}`,
    maxActiveRuns: maxActiveRuns(),
  });
}

if (import.meta.main) {
  void main().catch((error) => {
    process.stderr.write(`Refusing to start: ${String(error)}\n`);
    process.exit(1);
  });
}
