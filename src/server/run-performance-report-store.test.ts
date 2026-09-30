import { describe, expect, it } from "bun:test";

import type { MysqlExecutor, MysqlValue } from "../internal/mysql";
import { RUN_PERFORMANCE_REPORT_SCHEMA_VERSION } from "./run-performance-report-schema";
import {
  makeRunPerformanceReportStore,
  RunPerformanceReportStoreError,
} from "./run-performance-report-store";
import type { StoredRunPerformanceReport } from "./run-performance-report-store";

function emptyRequestPerf() {
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
    errorStatusCounts: [] as { status: string; count: number }[],
  };
}

function sampleRecord(): StoredRunPerformanceReport {
  return {
    runId: "22222222-2222-4222-8222-222222222222",
    schemaVersion: RUN_PERFORMANCE_REPORT_SCHEMA_VERSION,
    computedAt: "2026-09-06T12:00:00.000Z",
    status: "complete",
    error: null,
    report: {
      schemaVersion: RUN_PERFORMANCE_REPORT_SCHEMA_VERSION,
      runId: "22222222-2222-4222-8222-222222222222",
      computedAt: "2026-09-06T12:00:00.000Z",
      status: "succeeded",
      requestPerf: emptyRequestPerf(),
      gpqa: null,
    },
  };
}

describe("run performance report store", () => {
  it("upserts and reads a report row", async () => {
    const values: MysqlValue[][] = [];
    const rows: Record<string, unknown>[] = [];
    const executor: MysqlExecutor = {
      execute: async (_sql, params) => {
        values.push([...(params ?? [])]);
        return { affectedRows: 1, insertId: 0 };
      },
      query: async () => rows,
    };
    const store = makeRunPerformanceReportStore(executor);
    const record = sampleRecord();
    await store.upsert(record);
    expect(values[0]?.[0]).toBe(record.runId);
    expect(values[0]?.[3]).toBe("complete");
    rows.push({
      run_id: record.runId,
      schema_version: record.schemaVersion,
      computed_at: new Date(record.computedAt),
      status: record.status,
      error: null,
      report_json: JSON.stringify(record.report),
    });
    await expect(store.get(record.runId)).resolves.toEqual(record);
  });

  it("wraps MySQL failures", async () => {
    const executor: MysqlExecutor = {
      execute: async () => {
        throw new Error("connection refused");
      },
      query: async () => {
        throw new Error("connection refused");
      },
    };
    const store = makeRunPerformanceReportStore(executor);
    await expect(store.upsert(sampleRecord())).rejects.toBeInstanceOf(
      RunPerformanceReportStoreError
    );
    await expect(store.get("missing")).rejects.toBeInstanceOf(
      RunPerformanceReportStoreError
    );
  });
});
