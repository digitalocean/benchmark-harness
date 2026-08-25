#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
import {
  isDigitalOceanInferenceBaseUrl,
  isOpenRouterInferenceBaseUrl,
  makeModelCatalogClient,
  ModelCatalogError,
} from "./model-catalog";
import type { ModelCatalogClient } from "./model-catalog";
import {
  configureRunArtifactClient,
  describeRemoteRunParquet,
  readRemoteRunParquet,
  remoteRunArtifactResponse,
  remoteRunLogTailResponse,
} from "./run-artifact-read";
import {
  makeRunMetadataStore,
  RunMetadataStoreError,
} from "./run-metadata-store";
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
import type { RunArgs, RunRecord } from "./run-registry";
import { summarizeRunRows } from "./run-summary";

const DEFAULT_PORT = 8080;
const MAX_ACTIVE_RUNS = 3;
const DEFAULT_BENCHMARK = "gpqa_diamond";
const SUPPORTED_API_BENCHMARKS = [
  "gpqa_diamond",
  "tau_bench_verified_airline",
] as const;

const IDENTIFIER = /^[A-Za-z0-9._:\-/]+$/;
const DIGITALOCEAN_EMAIL = /@digitalocean\.com$/i;
let modelCatalogClient: ModelCatalogClient = makeModelCatalogClient();

export function configureModelCatalogClient(
  client: ModelCatalogClient | undefined
): void {
  modelCatalogClient = client ?? makeModelCatalogClient();
}

export const RunRequestSchema = z.object({
  benchmark: z.enum(SUPPORTED_API_BENCHMARKS).default(DEFAULT_BENCHMARK),
  triggeredByEmail: z
    .string()
    .trim()
    .email()
    .regex(DIGITALOCEAN_EMAIL)
    .transform((value) => value.toLowerCase()),
  inference: z.object({
    baseUrl: z.url(),
    apiKey: z.string().min(1),
    model: z.string().min(1).regex(IDENTIFIER),
    temperature: z.literal(0.5).optional(),
    maxTokens: z.number().int().positive().optional(),
    reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
    timeoutMs: z.number().int().positive().optional(),
    endpointId: z.string().min(1).optional(),
    costTier: z.enum(COST_TIERS).optional(),
    sort: z.nativeEnum(ProviderSort).optional(),
    cloudflareVersion: z.string().min(1).optional(),
    costQualityTradeoff: z.number().int().min(0).max(10).optional(),
    pinModel: z.boolean().optional(),
  }),
  execution: z.object({
    epochs: z.number().int().positive().max(20),
    concurrency: z.number().int().positive().max(64),
    unordered: z.boolean().optional(),
    limit: z.number().int().positive().max(1_000).optional(),
    start: z.number().int().min(0).max(999).optional(),
    end: z.number().int().positive().max(1_000).optional(),
    maxRetries: z.number().int().min(0).max(20).optional(),
  }),
  logLevel: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
});

const DisableRunSchema = z.object({
  disabled: z.boolean().optional(),
});

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

export function requestRecordsResponse(record: RunRecord): Response {
  if (!existsSync(record.requestLogPath)) {
    return json({ error: "request records not found", id: record.id }, 404);
  }
  return new Response(readFileSync(record.requestLogPath), {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
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

function hasRemoteArtifacts(
  metadata: Awaited<ReturnType<typeof getRunMetadata>>
): metadata is NonNullable<typeof metadata> {
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
  const { apiKey, ...inference } = parsed.right.inference;
  const args: RunArgs = {
    ...parsed.right,
    inference: {
      ...inference,
      temperature:
        parsed.right.benchmark === "tau_bench_verified_airline" ? 0 : 0.5,
    },
  };
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
    return json(await listRunMetadata());
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

  const runMatch =
    /^\/runs\/([^/]+)(\/logs|\/state|\/request-records|\/results|\/parquet|\/summary|\/cancel|\/disable)?$/.exec(
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
      return json(metadata);
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
        : requestRecordsResponse(record);
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
  await loadPersistedRuns();
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
