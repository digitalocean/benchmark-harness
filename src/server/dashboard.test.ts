import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SpacesArtifactClient } from "../internal/spaces";
import {
  configureModelCatalogClient,
  handleRequest,
  logDownloadResponse,
  parquetResponse,
  requestRecordsDownloadResponse,
  requestRecordsResponse,
  runStateResponse,
} from "./index";
import { ModelCatalogError } from "./model-catalog";
import type { ModelCatalogClient } from "./model-catalog";
import { configureRunArtifactClient } from "./run-artifact-read";
import type { RunMetadataStore } from "./run-metadata-store";
import { configureRunMetadataStore } from "./run-registry";
import type { RunRecord } from "./run-registry";

const originalToken = process.env["BENCH_API_TOKEN"];
const originalTriggerSecret = process.env["BENCH_RUN_TRIGGER_SECRET"];
let artifactDirectory: string | undefined;

const metadata = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "succeeded" as const,
  args: {
    benchmark: "gpqa_diamond" as const,
    triggeredByEmail: "user@digitalocean.com",
    inference: {
      baseUrl: "https://inference.example.com/v1",
      model: "provider/model",
      temperature: 0.5 as const,
    },
    execution: { epochs: 1, concurrency: 2, unordered: true, limit: 10 },
  },
  startedAt: "2026-08-14T10:00:00.000Z",
  finishedAt: "2026-08-14T10:05:00.000Z",
  exitCode: 0,
  expectedQuestions: 10,
  completedQuestions: 9,
  skippedQuestions: 1,
  completionPercentage: 100,
  totalEvaluations: 10,
  completedEvaluations: 9,
  skippedEvaluations: 1,
  qualityScore: 0.8,
  disabled: false,
  cancelRequestedAt: null,
  uploadStatus: "complete" as const,
  uploadError: null,
  uploadedAt: "2026-08-14T10:06:00.000Z",
  spacesBucket: "bucket",
  spacesPrefix: "prefix",
  manifestKey: "prefix/manifest.json",
  triggeredByEmail: "user@digitalocean.com",
};

beforeEach(() => {
  process.env["BENCH_API_TOKEN"] = "test-token";
  process.env["BENCH_RUN_TRIGGER_SECRET"] = "trigger-password";
  const store: RunMetadataStore = {
    upsert: () => Promise.resolve(),
    setDisabled: () => Promise.resolve(),
    get: () => Promise.resolve(metadata),
    list: () => Promise.resolve([metadata]),
  };
  configureRunMetadataStore(store);
});

afterEach(() => {
  configureModelCatalogClient(undefined);
  configureRunArtifactClient(undefined);
  if (originalToken === undefined) {
    Reflect.deleteProperty(process.env, "BENCH_API_TOKEN");
  } else {
    process.env["BENCH_API_TOKEN"] = originalToken;
  }
  if (originalTriggerSecret === undefined) {
    Reflect.deleteProperty(process.env, "BENCH_RUN_TRIGGER_SECRET");
  } else {
    process.env["BENCH_RUN_TRIGGER_SECRET"] = originalTriggerSecret;
  }
  if (artifactDirectory !== undefined) {
    rmSync(artifactDirectory, { recursive: true, force: true });
    artifactDirectory = undefined;
  }
});

describe("benchmark runs dashboard", () => {
  it("serves the token-entry shell without exposing run data", async () => {
    const response = await handleRequest(
      new Request("http://localhost/gpqa-benchmarks")
    );
    const root = await handleRequest(new Request("http://localhost/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(root.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("Benchmark Runs");
    expect(body).toContain("Enter password to view the benchmarks");
    expect(body).not.toContain("API bearer token");
    expect(body).toContain("artifact-row");
    expect(body).toContain('"Logs"');
    expect(body).toContain('"Requests"');
    expect(body).toContain('"Run state"');
    expect(body).toContain('"Parquet"');
    expect(body).toContain("Download raw JSONL");
    expect(body).toContain('"Duration (seconds)"');
    expect(body).toContain("Duration >");
    expect(body).toContain("X seconds");
    expect(body).toContain("Auto-refresh on · 10s");
    expect(body).toContain("Auto-refresh on · 1 min");
    expect(body).toContain("auto-refresh-indicator");
    expect(body).toContain("auto-refresh-dot");
    expect(body).toContain("tab.__requestAutoRefreshTimer");
    expect(body).toContain("tab.__requestRefreshInFlight");
    expect(body).toContain("tab.__requestFilterState");
    expect(body).toContain("}, 60000)");
    expect(body).toContain("return bStart.localeCompare(aStart)");
    expect(body).not.toContain('"Response",');
    expect(body).toContain('"Provider",');
    expect(body).toContain('completed?.provider_name || "—"');
    expect(body).toContain('filterLabel.textContent = "Status"');
    expect(body).toContain('"Success ("');
    expect(body).toContain('"Pending ("');
    expect(body).toContain('"Error ("');
    expect(body).toContain("Errors only");
    expect(body).toContain('attemptFilterLabel.textContent = "Attempt >"');
    expect(body).toContain("row.dataset.attemptCount");
    expect(body).toContain(
      "Number(row.dataset.attemptCount) > Number(attemptThreshold)"
    );
    expect(body).toContain('"No."');
    expect(body).toContain('run.id + "-results.parquet"');
    expect(body).not.toContain("openParquet");
    expect(body).toContain("<th>Artifacts</th>");
    expect(body).toContain("<th>No.</th>");
    expect(body).toContain("<th>Run</th>");
    expect(body).toContain("<th>Timing</th>");
    expect(body).toContain("<th>Configuration</th>");
    expect(body).toContain('id="run-model-filter"');
    expect(body).toContain('id="run-duration-filter"');
    expect(body).toContain('id="run-triggered-filter"');
    expect(body).toContain('id="run-status-filter"');
    expect(body).toContain('id="run-quality-filter"');
    expect(body).toContain('id="hide-canary-runs" type="checkbox" checked');
    expect(body).toContain("Hide canary runs");
    expect(body).toContain('id="show-disabled-runs" type="checkbox"');
    expect(body).toContain("Show disabled runs");
    expect(body).toContain("showDisabledRuns.checked || !run.disabled");
    expect(body).toContain('run.disabled ? "Enable run" : "Disable run"');
    expect(body).toContain(
      'run.status === "failed" || run.status === "cancelled"'
    );
    expect(body).toContain("genai-temporal-worker@digitalocean.com");
    expect(body).toContain("!hideCanaryRuns.checked");
    expect(body).toContain("runDurationSeconds(run) > Number(duration)");
    expect(body).toContain("run.qualityScore * 100 < Number(quality)");
    expect(body).toContain(
      '"Showing " + filtered.length + " of " + loadedRuns.length + " runs"'
    );
    expect(body).not.toContain("<th>Started</th>");
    expect(body).not.toContain("<th>Model</th>");
    expect(body).not.toContain("<th>Base URL</th>");
    expect(body).not.toContain("<th>Logs</th>");
    expect(body).toContain("Cancel run");
    expect(body).toContain("Quality");
    expect(body).toContain("View summary");
    expect(body).toContain("quality-details");
    expect(body).toContain("upload-warning");
    expect(body).toContain('run.uploadStatus === "failed"');
    expect(body).toContain("Spaces artifact upload failed");
    expect(body).toContain("% complete");
    expect(body).not.toContain("Evaluations completed");
    expect(body).not.toContain("Evaluations skipped");
    expect(body).toContain("Completed:");
    expect(body).toContain("Duration:");
    expect(body).toContain("Epochs:");
    expect(body).toContain("Concurrency:");
    expect(body).toContain("Limit:");
    expect(body).toContain("Benchmark:");
    expect(body).toContain('"Show more"');
    expect(body).toContain('"Show less"');
    expect(body).toContain('moreDetails.open ? "Show less" : "Show more"');
    expect(body).toContain("Subdomain breakdown");
    expect(body).not.toContain(" executed");
    expect(body).toContain("Start benchmark");
    expect(body).toContain('name="benchmark"');
    expect(body).toContain('value="gpqa_diamond">GPQA Diamond');
    expect(body).toContain(
      'value="tau_bench_verified_airline">TAU Bench Verified Airline'
    );
    expect(body).toContain('name="apiKey"');
    expect(body).toContain('id="inference-base-url"');
    expect(body).toContain(
      'value="https://inference.do-ai.run/v1">https://inference.do-ai.run/v1'
    );
    expect(body).toContain(
      'value="https://inference.do-ai-test.run/v1">https://inference.do-ai-test.run/v1'
    );
    expect(body).toContain(
      'value="https://openrouter.ai/api/v1">https://openrouter.ai/api/v1'
    );
    expect(body).toContain(">Other</option>");
    expect(body).toContain('id="catalog-model"');
    expect(body).toContain('id="catalog-model-label"');
    expect(body).toContain('list="catalog-model-options"');
    expect(body).toContain('id="catalog-model-options"');
    expect(body).toContain("catalogModels.has(catalogModel.value)");
    expect(body).toContain('id="manual-base-url"');
    expect(body).toContain('id="manual-model"');
    expect(body).toContain("catalogModelLabel.hidden = isOther");
    expect(body).toContain(
      ".form-grid label[hidden], .form-grid div[hidden] { display: none; }"
    );
    expect(body).not.toContain("Custom inference base URL");
    expect(body).not.toContain("Custom model");
    expect(body).toContain("configureInferenceControls");
    expect(body).toContain("/model-catalog?baseUrl=");
    expect(body).toContain('name="triggerSecret"');
    expect(body).toContain('name="triggeredByEmail"');
    expect(body).toContain('name="concurrency"');
    expect(body).toContain('name="unordered" type="checkbox" checked');
    expect(body).toContain("Use rolling unordered concurrency");
    expect(body).toContain("info-icon");
    expect(body).toContain("useful for quick results");
    expect(body).toContain(
      "100% order sync with OpenRouter's execution script"
    );
    expect(body).toContain("identical scores are not guaranteed");
    expect(body).toContain('unordered: data.get("unordered") === "on"');
    expect(body).toContain("Unordered:");
    expect(body).toContain("Advanced configuration");
    expect(body).not.toContain('id="advanced-summary"');
    expect(body).not.toContain("Reset to defaults");
    expect(body).toContain("advancedConfigurationEntries");
    expect(body).toContain('"Advanced (" + advancedEntries.length + ")"');
    expect(body).toContain('className = "run-advanced"');
    expect(body).toContain('["Reasoning", inference.reasoningEffort]');
    expect(body).toContain('["Max retries", execution.maxRetries]');
    expect(body).toContain('id="run-detail-banner"');
    expect(body).toContain('id="back-to-runs"');
    expect(body).toContain(".run-detail-banner[hidden] { display: none; }");
    expect(body).toContain("selectedRunId");
    expect(body).toContain("runDashboardUrl");
    expect(body).toContain("copyRunLink");
    expect(body).toContain("legacyCopyText");
    expect(body).toContain('document.execCommand("copy")');
    expect(body).toContain("navigator.clipboard?.writeText");
    expect(body).toContain('runId.className = "run-id"');
    expect(body).toContain('copy.textContent = "⧉"');
    expect(body).toContain('copy.title = "Copy run link"');
    expect(body).not.toContain('view.textContent = "Details"');
    expect(body).toContain('runId === null ? "/runs" : "/runs/"');
    expect(body).toContain('name="maxTokens"');
    expect(body).toContain('name="reasoningEffort"');
    expect(body).toContain('name="timeoutMs"');
    expect(body).toContain('name="sort"');
    expect(body).toContain('name="cloudflareVersion"');
    expect(body).toContain('name="costQualityTradeoff"');
    expect(body).toContain('name="pinModel"');
    expect(body).toContain('name="maxRetries"');
    expect(body).toContain(
      '...(reasoningEffort === "" ? {} : { reasoningEffort })'
    );
    expect(body).toContain(
      '...(pinModel === "" ? {} : { pinModel: pinModel === "true" })'
    );
    expect(body).toContain(
      '...(maxRetries === "" ? {} : { maxRetries: Number(maxRetries) })'
    );
    expect(body).not.toContain("<th>Triggered by</th>");
    expect(body).toContain("Triggered by:");
    expect(body).toContain("sessionStorage");
    expect(body).not.toContain("provider/model");
  });

  it("keeps run metadata and logs protected by bearer authentication", async () => {
    const runsUnauthorized = await handleRequest(
      new Request("http://localhost/runs")
    );
    const logsUnauthorized = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/logs`)
    );
    const requestsUnauthorized = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/request-records`)
    );
    const stateUnauthorized = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/state`)
    );
    const parquetUnauthorized = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/parquet`)
    );
    const summaryUnauthorized = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/summary`)
    );
    const runsAuthorized = await handleRequest(
      new Request("http://localhost/runs", {
        headers: { Authorization: "Bearer test-token" },
      })
    );

    expect(runsUnauthorized.status).toBe(401);
    expect(logsUnauthorized.status).toBe(401);
    expect(requestsUnauthorized.status).toBe(401);
    expect(stateUnauthorized.status).toBe(401);
    expect(parquetUnauthorized.status).toBe(401);
    expect(summaryUnauthorized.status).toBe(401);
    expect(runsAuthorized.status).toBe(200);
    expect(await runsAuthorized.json()).toEqual([metadata]);
  });

  it("requires the backend run trigger password for new runs", async () => {
    const invalidSecret = await handleRequest(
      new Request("http://localhost/runs", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
          "X-Bench-Run-Secret": "wrong",
        },
        body: "{}",
      })
    );
    const validSecret = await handleRequest(
      new Request("http://localhost/runs", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
          "X-Bench-Run-Secret": "trigger-password",
        },
        body: "{}",
      })
    );

    expect(invalidSecret.status).toBe(403);
    expect(validSecret.status).toBe(400);
  });

  it("disables and re-enables persisted runs", async () => {
    const disable = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/disable`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
      })
    );
    const enable = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/disable`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ disabled: false }),
      })
    );

    expect(disable.status).toBe(200);
    expect((await disable.json()).disabled).toBe(true);
    expect(enable.status).toBe(200);
    expect((await enable.json()).disabled).toBe(false);
  });

  it("returns catalog models only for supported inference endpoints", async () => {
    const client: ModelCatalogClient = {
      listDigitalOceanModels: () =>
        Promise.resolve(["newer-model", "older-model"]),
      listOpenRouterModels: () => Promise.resolve(["digitalocean/model"]),
    };
    configureModelCatalogClient(client);

    const success = await handleRequest(
      new Request(
        "http://localhost/model-catalog?baseUrl=https%3A%2F%2Finference.do-ai.run%2Fv1",
        { headers: { Authorization: "Bearer test-token" } }
      )
    );
    const invalid = await handleRequest(
      new Request(
        "http://localhost/model-catalog?baseUrl=https%3A%2F%2Finference.example.com%2Fv1",
        { headers: { Authorization: "Bearer test-token" } }
      )
    );

    expect(await success.json()).toEqual({
      baseUrl: "https://inference.do-ai.run/v1",
      models: ["newer-model", "older-model"],
    });
    expect(invalid.status).toBe(400);

    const openRouter = await handleRequest(
      new Request(
        "http://localhost/model-catalog?baseUrl=https%3A%2F%2Fopenrouter.ai%2Fapi%2Fv1",
        { headers: { Authorization: "Bearer test-token" } }
      )
    );
    expect(await openRouter.json()).toEqual({
      baseUrl: "https://openrouter.ai/api/v1",
      models: ["digitalocean/model"],
    });

    configureModelCatalogClient({
      listDigitalOceanModels: () =>
        Promise.reject(new ModelCatalogError("Catalog service unavailable")),
      listOpenRouterModels: () =>
        Promise.reject(new ModelCatalogError("Catalog service unavailable")),
    });
    const unavailable = await handleRequest(
      new Request(
        "http://localhost/model-catalog?baseUrl=https%3A%2F%2Finference.do-ai.run%2Fv1",
        { headers: { Authorization: "Bearer test-token" } }
      )
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: "Catalog service unavailable",
    });
  });

  it("serves completed artifacts from Spaces without local run state", async () => {
    const client: SpacesArtifactClient = {
      bucket: "bucket",
      getFile: ({ key }) =>
        Promise.resolve(
          key === "prefix/requests/requests.jsonl"
            ? {
                body: new Blob(['{"event":"completed"}\n']).stream(),
                contentType: "application/x-ndjson",
              }
            : undefined
        ),
      putFile: () => Promise.resolve(),
      signedGetUrl: () => Promise.resolve("https://bucket.example/signed"),
    };
    configureRunArtifactClient(client);

    const response = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/request-records`, {
        headers: { Authorization: "Bearer test-token" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"event":"completed"}\n');
  });

  it("serves complete run artifacts", async () => {
    artifactDirectory = mkdtempSync(join(tmpdir(), "dashboard-artifacts-"));
    const requestsDir = join(artifactDirectory, "requests");
    const resultsDir = join(artifactDirectory, "results");
    mkdirSync(requestsDir);
    mkdirSync(resultsDir);
    const logPath = join(artifactDirectory, "run.log");
    const requestLogPath = join(requestsDir, "requests.jsonl");
    const statePath = join(artifactDirectory, "run.json");
    const parquetPath = join(resultsDir, "result.parquet");
    writeFileSync(logPath, "running\n");
    writeFileSync(requestLogPath, '{"event":"started"}\n');
    writeFileSync(statePath, '{"status":"running"}\n');
    writeFileSync(parquetPath, new Uint8Array([80, 65, 82, 49]));
    const record: RunRecord = {
      ...metadata,
      argv: [],
      pid: null,
      root: artifactDirectory,
      logPath,
      requestLogPath,
      resultsDir,
    };

    const logsDownload = logDownloadResponse(record);
    const requests = requestRecordsResponse(record);
    const requestsDownload = requestRecordsDownloadResponse(record);
    const state = runStateResponse(record);
    const stateDownload = runStateResponse(record, true);
    const parquet = parquetResponse(record);

    expect(await logsDownload.text()).toBe("running\n");
    expect(logsDownload.headers.get("content-disposition")).toContain(
      `${record.id}-run.log`
    );
    expect(await requests.text()).toBe('{"event":"started"}\n');
    expect(requests.headers.get("content-type")).toContain(
      "application/x-ndjson"
    );
    expect(requestsDownload.headers.get("content-disposition")).toContain(
      `${record.id}-requests.jsonl`
    );
    expect(await state.json()).toEqual({ status: "running" });
    expect(stateDownload.headers.get("content-disposition")).toContain(
      `${record.id}-run.json`
    );
    expect(parquet.headers.get("content-type")).toBe(
      "application/vnd.apache.parquet"
    );
    expect(parquet.headers.get("content-disposition")).toContain(
      'filename="result.parquet"'
    );
    expect(new Uint8Array(await parquet.arrayBuffer())).toEqual(
      new Uint8Array([80, 65, 82, 49])
    );
  });
});
