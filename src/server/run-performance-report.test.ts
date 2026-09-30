import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  __testOnlyResetPerformanceReportStore,
  buildRequestPerf,
  buildRunPerformanceReport,
  computeAndPersistRunPerformanceReport,
  configureRunPerformanceReportStore,
  gpqaReportArtifactPath,
  parseRequestLogEntries,
  percentile,
  performanceReportPath,
} from "./run-performance-report";
import type {
  RunPerformanceReportStore,
  StoredRunPerformanceReport,
} from "./run-performance-report-store";
import type { RunRecord } from "./run-registry";

let temporaryDirectory: string | undefined;

afterEach(() => {
  __testOnlyResetPerformanceReportStore();
  if (temporaryDirectory !== undefined) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

function makeTempDir(): string {
  temporaryDirectory = mkdtempSync(
    join(tmpdir(), "run-performance-report-test-")
  );
  return temporaryDirectory;
}

function memoryStore(): {
  readonly store: RunPerformanceReportStore;
  readonly records: Map<string, StoredRunPerformanceReport>;
} {
  const records = new Map<string, StoredRunPerformanceReport>();
  return {
    records,
    store: {
      upsert: async (record) => {
        records.set(record.runId, record);
      },
      get: async (runId) => records.get(runId),
    },
  };
}

function baseRecord(root: string): RunRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "succeeded",
    args: {
      benchmark: "tau_bench_verified_airline",
      inference: {
        baseUrl: "https://inference.example.com/v1",
        model: "provider/model",
        temperature: 0,
      },
      execution: { epochs: 1, concurrency: 2 },
    },
    argv: [],
    pid: null,
    startedAt: "2026-09-06T10:00:00.000Z",
    finishedAt: "2026-09-06T10:05:00.000Z",
    exitCode: 0,
    expectedQuestions: 1,
    completedQuestions: 1,
    skippedQuestions: 0,
    totalEvaluations: 1,
    completedEvaluations: 1,
    skippedEvaluations: 0,
    completionPercentage: 100,
    qualityScore: 1,
    disabled: false,
    cancelRequestedAt: null,
    failureReason: null,
    uploadStatus: "pending",
    uploadError: null,
    uploadedAt: null,
    spacesBucket: null,
    spacesPrefix: null,
    manifestKey: null,
    root,
    logPath: join(root, "logs", "run.log"),
    requestLogPath: join(root, "requests", "requests.jsonl"),
    resultsDir: join(root, "results"),
  };
}

describe("run performance report metrics", () => {
  it("computes percentiles with linear interpolation", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([], 0.5)).toBeNull();
  });

  it("aggregates latency, retries, error split, and frozen concurrency", () => {
    const entries = parseRequestLogEntries(
      [
        JSON.stringify({
          event: "started",
          request_id: "r1",
          attempt: 1,
          started_at: "2026-09-06T10:00:00.000Z",
        }),
        JSON.stringify({
          event: "completed",
          request_id: "r1",
          attempt: 1,
          started_at: "2026-09-06T10:00:00.000Z",
          finished_at: "2026-09-06T10:00:01.000Z",
          duration_ms: 1000,
          ok: true,
          status: 200,
          usage: { output_tokens: 100 },
        }),
        JSON.stringify({
          event: "started",
          request_id: "r2",
          attempt: 2,
          started_at: "2026-09-06T10:00:00.500Z",
        }),
        JSON.stringify({
          event: "completed",
          request_id: "r2",
          attempt: 2,
          started_at: "2026-09-06T10:00:00.500Z",
          finished_at: "2026-09-06T10:00:02.000Z",
          duration_ms: 1500,
          ok: false,
          status: 429,
        }),
        JSON.stringify({
          event: "started",
          request_id: "r3",
          attempt: 1,
          started_at: "2026-09-06T10:00:01.000Z",
        }),
      ].join("\n")
    );
    const freezeAt = Date.parse("2026-09-06T10:05:00.000Z");
    const perf = buildRequestPerf(entries, freezeAt);
    expect(perf.requestCount).toBe(3);
    expect(perf.completedCount).toBe(2);
    expect(perf.pendingCount).toBe(1);
    expect(perf.successfulCount).toBe(1);
    expect(perf.errorCount).toBe(1);
    expect(perf.retryAttemptCount).toBe(1);
    expect(perf.latencyMs.p50).toBe(1250);
    expect(perf.errorStatusCounts).toEqual([{ status: "429", count: 1 }]);
    expect(perf.peakInFlight).toBeGreaterThanOrEqual(1);
    expect(perf.effectiveOutputTokensPerSecond).toBe(100);
  });

  it("persists compact report artifacts and store rows", async () => {
    const root = makeTempDir();
    mkdirSync(join(root, "requests"), { recursive: true });
    const record = baseRecord(root);
    writeFileSync(
      record.requestLogPath,
      `${JSON.stringify({
        event: "started",
        request_id: "r1",
        attempt: 1,
        started_at: "2026-09-06T10:00:00.000Z",
      })}\n${JSON.stringify({
        event: "completed",
        request_id: "r1",
        attempt: 1,
        started_at: "2026-09-06T10:00:00.000Z",
        finished_at: "2026-09-06T10:00:01.000Z",
        duration_ms: 1000,
        ok: true,
        status: 200,
      })}\n`
    );
    const { store, records } = memoryStore();
    configureRunPerformanceReportStore(store);
    const stored = await computeAndPersistRunPerformanceReport(record);
    expect(stored?.status).toBe("complete");
    expect(records.get(record.id)?.report.requestPerf.requestCount).toBe(1);
    expect(existsSync(performanceReportPath(record))).toBe(true);
    expect(
      JSON.parse(readFileSync(performanceReportPath(record), "utf8"))
    ).toMatchObject({
      runId: record.id,
      gpqa: null,
    });
    expect(existsSync(gpqaReportArtifactPath(record))).toBe(false);
  });

  it("skips store writes when unconfigured and does not throw", async () => {
    const root = makeTempDir();
    const record = baseRecord(root);
    mkdirSync(join(root, "requests"), { recursive: true });
    writeFileSync(record.requestLogPath, "");
    await expect(
      computeAndPersistRunPerformanceReport(record)
    ).resolves.toBeUndefined();
  });

  it("builds an empty requestPerf report for missing request logs", async () => {
    const root = makeTempDir();
    const record = baseRecord(root);
    const built = await buildRunPerformanceReport(record);
    expect(built.payload.requestPerf.requestCount).toBe(0);
    expect(built.payload.gpqa).toBeNull();
    expect(built.gpqaReportFile).toBeNull();
  });
});
