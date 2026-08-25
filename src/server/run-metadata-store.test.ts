import { describe, expect, it } from "bun:test";

import type { MysqlExecutor } from "../internal/mysql";
import {
  makeRunMetadataStore,
  recordToMetadata,
  RunMetadataStoreError,
} from "./run-metadata-store";
import type { RunRecord } from "./run-registry";

function record(): RunRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    status: "succeeded",
    args: {
      benchmark: "gpqa_diamond",
      triggeredByEmail: "user@digitalocean.com",
      inference: {
        baseUrl: "https://inference.example.com/v1",
        model: "provider/model",
        temperature: 0.5,
        maxTokens: 4096,
        reasoningEffort: "high",
        pinModel: true,
      },
      execution: {
        epochs: 5,
        concurrency: 8,
        unordered: true,
        limit: 20,
        maxRetries: 4,
      },
    },
    argv: ["--benchmark", "gpqa_diamond"],
    pid: 123,
    startedAt: "2026-08-14T10:00:00.000Z",
    finishedAt: "2026-08-14T10:05:00.000Z",
    exitCode: 0,
    expectedQuestions: 20,
    completedQuestions: 18,
    skippedQuestions: 2,
    completionPercentage: 90,
    totalEvaluations: 100,
    completedEvaluations: 88,
    skippedEvaluations: 2,
    qualityScore: 0.75,
    disabled: false,
    cancelRequestedAt: null,
    uploadStatus: "complete",
    uploadError: null,
    uploadedAt: "2026-08-14T10:06:00.000Z",
    spacesBucket: "benchmark-results",
    spacesPrefix: "benchmark-runs/gpqa/2026/08/14/run-id",
    manifestKey: "benchmark-runs/gpqa/2026/08/14/run-id/manifest.json",
    root: "logs/api/run-id",
    logPath: "logs/api/run-id/logs/run.log",
    requestLogPath: "logs/api/run-id/requests/requests.jsonl",
    resultsDir: "logs/api/run-id/results",
  };
}

function row(): Record<string, unknown> {
  const run = record();
  return {
    id: run.id,
    benchmark: "gpqa_diamond",
    model: "provider/model",
    base_url: "https://inference.example.com/v1",
    status: "succeeded",
    disabled: 0,
    started_at: new Date(run.startedAt),
    finished_at: new Date(run.finishedAt!),
    cancel_requested_at: null,
    exit_code: 0,
    expected_questions: 20,
    completed_questions: 18,
    skipped_questions: 2,
    completion_percentage: "90.00",
    total_evaluations: 100,
    completed_evaluations: 88,
    skipped_evaluations: 2,
    quality_score: "0.75000000",
    epochs: 5,
    concurrency: 8,
    unordered: 1,
    row_limit: 20,
    range_start: null,
    range_end: null,
    max_retries: 4,
    temperature: "0.500",
    max_tokens: 4096,
    reasoning_effort: "high",
    timeout_ms: null,
    endpoint_id: null,
    cost_tier: null,
    provider_sort: null,
    cloudflare_version: null,
    cost_quality_tradeoff: null,
    pin_model: 1,
    log_level: null,
    upload_status: "complete",
    upload_error: null,
    uploaded_at: new Date(run.uploadedAt!),
    spaces_bucket: run.spacesBucket,
    spaces_prefix: run.spacesPrefix,
    manifest_key: run.manifestKey,
    triggered_by_email: "user@digitalocean.com",
  };
}

describe("MySQL run metadata store", () => {
  it("upserts queryable fields without local paths or credentials", async () => {
    let capturedValues: readonly unknown[] = [];
    const executor: MysqlExecutor = {
      execute: (_sql, values = []) => {
        capturedValues = values;
        return Promise.resolve();
      },
      query: <Row extends object>() => Promise.resolve([] as Row[]),
      close: () => Promise.resolve(),
    };

    await makeRunMetadataStore(executor, { attempts: 1 }).upsert(record());

    const serialized = JSON.stringify(capturedValues);
    expect(capturedValues).toHaveLength(44);
    expect(serialized).toContain("provider/model");
    expect(serialized).not.toContain("logs/api");
    expect(serialized).not.toContain("apiKey");
  });

  it("validates rows and returns secret-safe metadata", async () => {
    const executor: MysqlExecutor = {
      execute: () => Promise.resolve(),
      query: <Row extends object>() => Promise.resolve([row()] as Row[]),
      close: () => Promise.resolve(),
    };

    const metadata = await makeRunMetadataStore(executor, {
      attempts: 1,
    }).get(record().id);

    expect(metadata).toEqual(recordToMetadata(record()));
    expect(JSON.stringify(metadata)).not.toContain("apiKey");
    expect(metadata).not.toHaveProperty("root");
    expect(metadata).not.toHaveProperty("pid");
  });

  it("persists disabled state separately from run metadata", async () => {
    let sql = "";
    let values: readonly unknown[] = [];
    const executor: MysqlExecutor = {
      execute: (statement, parameters = []) => {
        sql = statement;
        values = parameters;
        return Promise.resolve();
      },
      query: <Row extends object>() => Promise.resolve([] as Row[]),
      close: () => Promise.resolve(),
    };

    await makeRunMetadataStore(executor, { attempts: 1 }).setDisabled(
      record().id,
      true
    );

    expect(sql).toContain("UPDATE benchmark_runs SET disabled = ?");
    expect(values).toEqual([true, record().id]);
  });

  it("fails after the configured number of write attempts", async () => {
    let attempts = 0;
    const executor: MysqlExecutor = {
      execute: () => {
        attempts += 1;
        return Promise.reject(new Error("unavailable"));
      },
      query: <Row extends object>() => Promise.resolve([] as Row[]),
      close: () => Promise.resolve(),
    };
    const store = makeRunMetadataStore(executor, {
      attempts: 2,
      delayMs: 0,
    });

    await expect(store.upsert(record())).rejects.toBeInstanceOf(
      RunMetadataStoreError
    );
    expect(attempts).toBe(2);
  });
});
