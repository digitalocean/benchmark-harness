import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MessageRole, ScoreValue } from "../harness/core";
import type { SpacesArtifactClient } from "../internal/spaces";
import { runResultToParquet } from "../results/parquet";
import {
  configureModelCatalogClient,
  gpqaReportResponse,
  handleRequest,
  logDownloadResponse,
  parquetResponse,
  requestRecordsDownloadResponse,
  requestRecordsResponse,
  runStateResponse,
} from "./index";
import { ModelCatalogError } from "./model-catalog";
import type { ModelCatalogClient } from "./model-catalog";
import { resetReportRetriesForTests } from "./report-retry";
import { configureRunArtifactClient } from "./run-artifact-read";
import type { RunMetadataStore } from "./run-metadata-store";
import {
  configureRunPerformanceReportStore,
  __testOnlyResetPerformanceReportStore,
} from "./run-performance-report";
import type {
  RunPerformanceReportStore,
  StoredRunPerformanceReport,
} from "./run-performance-report-store";
import { configureRunMetadataStore } from "./run-registry";
import type { RunRecord } from "./run-registry";

const originalToken = process.env["BENCH_API_TOKEN"];
const originalTriggerSecret = process.env["BENCH_RUN_TRIGGER_SECRET"];
let artifactDirectory: string | undefined;
const performanceReports = new Map<string, StoredRunPerformanceReport>();

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
  failureReason: null,
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
  performanceReports.clear();
  const store: RunMetadataStore = {
    upsert: () => Promise.resolve(),
    setDisabled: () => Promise.resolve(),
    get: () => Promise.resolve(metadata),
    list: () => Promise.resolve([metadata]),
  };
  configureRunMetadataStore(store);
  const reportStore: RunPerformanceReportStore = {
    upsert: async (record) => {
      performanceReports.set(record.runId, record);
    },
    get: async (runId) => performanceReports.get(runId),
  };
  configureRunPerformanceReportStore(reportStore);
});

afterEach(() => {
  resetReportRetriesForTests();
  __testOnlyResetPerformanceReportStore();
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
    expect(body).toContain('"GPQA report"');
    expect(body).toContain('"TAU report"');
    expect(body).toContain('"Parquet"');
    expect(body).toContain('"⧉ " + label');
    expect(body).toContain("Copy question and choices");
    expect(body).toContain("Copy the generated model answer");
    expect(body).toContain("Copy a reproducible inference cURL");
    expect(body).toContain("Diagnostic retry");
    expect(body).toContain("Start retry");
    expect(body).toContain("/diagnostic-retries");
    expect(body).toContain("Retry run");
    expect(body).toContain("openRunRetry(run)");
    expect(body).toContain('setStartFormValue("triggerSecret", "")');
    expect(body).toContain('setStartFormValue("apiKey", "")');
    expect(body).toContain('setStartFormValue("limit", execution.limit)');
    expect(body).toContain(
      'sweAtlasJudgeModel.value = run.args.judgeModel || ""'
    );
    expect(body).toContain("Retry failed questions");
    expect(body).toContain("Retry and compare with other providers");
    expect(body).toContain("openGpqaRetryCampaigns(id, tab)");
    expect(body).toContain("← Back to GPQA report");
    expect(body).toContain("← Back to retry comparisons");
    expect(body).toContain("/gpqa-retry-comparisons");
    expect(body).toContain("Run alternate provider or model arm");
    expect(body).toContain("Calls per question");
    expect(body).toContain("createArmEditor");
    expect(body).toContain("data.sourceExecution");
    expect(body).toContain("Advanced configuration");
    expect(body).toContain("Use rolling unordered concurrency");
    expect(body).toContain(".fields .checkbox-row");
    expect(body).toContain("View inference requests");
    expect(body).toContain("No question has completed yet");
    expect(body).toContain("Comparison report unavailable");
    expect(body).toContain("This retry comparison was cancelled");
    expect(body).toContain("unfinished responses appear empty");
    expect(body).toContain("Only applies to OpenRouter auto-router models");
    expect(body).toContain("configurePinModelVisibility");
    expect(body).toContain("Original run responses");
    expect(body).toContain("Current retry · original provider");
    expect(body).toContain("Full model response");
    expect(body).toContain("Exposed reasoning");
    expect(body).toContain("Download JSON");
    expect(body).toContain("Download filtered JSON");
    expect(body).toContain("Rerun this complete TAU scenario");
    expect(body).toContain("<INFERENCE_API_KEY>");
    expect(body).toContain('baseUrl + "/chat/completions"');
    expect(body).toContain("copyTextToClipboard");
    expect(body).toContain("openGpqaReport");
    expect(body).toContain('statusFilters.className = "status-filters"');
    expect(body).toContain('statusLegend.textContent = "Results"');
    expect(body).toContain('input.type = "checkbox"');
    expect(body).toContain("input.checked = true");
    expect(body).toContain("statusFilterInputs");
    expect(body).toContain('"Correct (" + report.correct');
    expect(body).toContain('"Wrong (" + report.wrong');
    expect(body).toContain('"No answer (" + report.noAnswer');
    expect(body).toContain('"Skipped (" + report.skipped');
    expect(body).toContain("const epochFilter = makeSelect(");
    expect(body).toContain("const subdomainFilter = makeSelect(");
    expect(body).toContain('makeSelect("Reasoning"');
    expect(body).toContain('document.createTextNode("Latency >")');
    expect(body).toContain('latencyFilter.placeholder = "X seconds"');
    expect(body).toContain("card.dataset.latencySeconds");
    expect(body).toContain("const itemMatchesFilters = (item, filters)");
    expect(body).toContain("filters.statuses.has(String(item.status))");
    expect(body).toContain("const filteredItems = () =>");
    expect(body).toContain("const GPQA_REPORT_DOWNLOAD_LIMIT = 100");
    expect(body).toContain("matching.slice(");
    expect(body).toContain("GPQA_REPORT_DOWNLOAD_LIMIT");
    expect(body).toContain("items: exportedItems");
    expect(body).toContain("appliedFilters:");
    expect(body).toContain('id + "-gpqa-report-filtered.json"');
    expect(body).toContain("latencyFilter.addEventListener");
    expect(body).toContain("Question, answer, reasoning…");
    expect(body).toContain("item.reasoning, true");
    expect(body).toContain('run.args.benchmark === "gpqa_diamond"');
    expect(body).toContain('run.id + "-gpqa-report.json"');
    expect(body).toContain("openTauAirlineReport");
    expect(body).toContain('run.id + "-tau-airline-report.json"');
    expect(body).toContain("snapshotPerf");
    expect(body).toContain(
      "runMetadata.performanceReport?.report?.gpqa?.analytics"
    );
    expect(body).toContain('"Expected evaluation criteria"');
    expect(body).toContain('"Actual tool calls"');
    expect(body).toContain('"Final agent answer"');
    expect(body).toContain('"Conversation"');
    expect(body).toContain('"Total model generation time"');
    expect(body).toContain('"Total agent generation time"');
    expect(body).toContain('"Latency: " + formatLatencyMs(item.latencyMs)');
    expect(body).toContain('" · Agent latency "');
    expect(body).toContain('makeSelect("Tool calls"');
    expect(body).toContain("const terminationFilter = makeSelect(");
    expect(body).toContain("Scenario, answer, tool call…");
    expect(body).toContain("Download raw JSONL");
    expect(body).toContain('"Duration (seconds)"');
    expect(body).toContain("Duration >");
    expect(body).toContain("X seconds");
    expect(body).toContain('"P50 latency"');
    expect(body).toContain('"P75 latency"');
    expect(body).toContain('"P90 latency"');
    expect(body).toContain('"P95 latency"');
    expect(body).toContain("Latency and throughput");
    expect(body).toContain("Reliability and errors");
    expect(body).toContain("latency-group");
    expect(body).toContain("reliability-group");
    expect(body).toContain('"Successful responses"');
    expect(body).toContain('"Pending requests"');
    expect(body).toContain('"Error responses"');
    expect(body).toContain('"Post-processing failures"');
    expect(body).toContain("Error status/code breakdown");
    expect(body).toContain("GPQA score diagnostics");
    expect(body).toContain("Epoch consistency");
    expect(body).toContain("Latency vs correctness");
    expect(body).toContain("Response-quality diagnostics");
    expect(body).toContain("Response length vs correctness");
    expect(body).toContain("Reasoning length vs correctness");
    expect(body).toContain("Hardest questions");
    expect(body).toContain("Epoch trends");
    expect(body).toContain("appendGpqaRequestAnalytics");
    expect(body).toContain('"/gpqa-report"');
    expect(body).not.toContain("Answer-choice confusion");
    expect(body).not.toContain("Provider performance");
    expect(body).not.toContain("Response processing");
    expect(body).not.toContain(
      "Latency percentiles use full duration for completed attempts."
    );
    expect(body).toContain('"Peak in-flight"');
    expect(body).toContain('"Average in-flight"');
    expect(body).toContain('"Throughput"');
    expect(body).toContain('"Effective output speed"');
    expect(body).toContain(
      'completed?.failure_stage === "response_processing"'
    );
    expect(body).toContain("Auto-refresh on · 10s");
    expect(body).toContain("Auto-refresh on · 1 min");
    expect(body).toContain("2 sec while requests are pending");
    expect(body).toContain(
      "requestDetails.open = expandedRequestIds.has(entry.requestId)"
    );
    expect(body).toContain("Show request/response");
    expect(body).toContain("populateRequestDetails");
    expect(body).toContain("requestDetails.querySelector");
    expect(body).not.toContain("expanded while pending");
    expect(body).toContain('querySelectorAll("pre[data-request-detail-key]")');
    expect(body).toContain("element.scrollTop = position.top");
    expect(body).toContain("element.scrollLeft = position.left");
    expect(body).toContain(
      "tab.scrollTo(pageScrollPosition.x, pageScrollPosition.y)"
    );
    expect(body).toContain("auto-refresh-indicator");
    expect(body).toContain("auto-refresh-dot");
    expect(body).toContain("tab.__requestAutoRefreshTimer");
    expect(body).toContain("tab.__requestRefreshInFlight");
    expect(body).toContain("tab.__requestFilterState");
    expect(body).toContain("const refreshDelay =");
    expect(body).toContain("return bStart.localeCompare(aStart)");
    expect(body).toContain('"Request / response"');
    expect(body).toContain("Show request/response");
    expect(body).toContain("Thinking / reasoning exposed by model");
    expect(body).toContain('event.event === "progress"');
    expect(body).toContain("x-request-log-next-offset");
    expect(body).toContain("tab.__requestMap = new Map()");
    expect(body).toContain("const parseText =");
    expect(body).toContain('"Provider",');
    expect(body).toContain('completed?.provider_name || "—"');
    expect(body).toContain('filterLabel.textContent = "Status"');
    expect(body).toContain('"Success ("');
    expect(body).toContain('"Pending ("');
    expect(body).toContain('"Error ("');
    expect(body).toContain("Errors only");
    expect(body).toContain('attemptFilterLabel.textContent = "Attempt >"');
    expect(body).toContain("row.dataset.attemptCount");
    expect(body).toContain("requestAttempt(entry) > Number(attemptThreshold)");
    expect(body).toContain("const requestPageSize = 100");
    expect(body).toContain("const applyRequestFilters = () => {");
    expect(body).toContain("const visibleEntries = filtered.slice");
    expect(body).toContain("up to 100 requests per page");
    expect(body).toContain("filterState.page = page");
    expect(body).toContain("reloadForFilters()");
    expect(body).toContain('"No."');
    expect(body).toContain('run.id + "-results.parquet"');
    expect(body).not.toContain("openParquet");
    expect(body).toContain("<th>Artifacts</th>");
    expect(body).toContain("<th>No.</th>");
    expect(body).toContain("<th>Run</th>");
    expect(body).toContain("<th>Timing</th>");
    expect(body).toContain("<th>Configuration</th>");
    expect(body).toContain('id="run-benchmark-filter"');
    expect(body).toContain('<option value="gpqa_diamond">GPQA</option>');
    expect(body).toContain(
      '<option value="tau_bench_verified_airline">TAU Airline</option>'
    );
    expect(body).toContain('<option value="deep_swe">Deep SWE</option>');
    expect(body).toContain(
      '<option value="swe_bench_verified">SWE-bench Verified</option>'
    );
    expect(body).toContain(
      '<option value="terminal_bench">Terminal-Bench 2.1</option>'
    );
    expect(body).toContain(
      '<option value="swe_atlas_qa">SWE Atlas QA</option>'
    );
    expect(body).toContain(
      '<option value="swe_atlas_tw">SWE Atlas Test Writing</option>'
    );
    expect(body).toContain(
      '<option value="swe_atlas_rf">SWE Atlas Refactoring</option>'
    );
    expect(body).toContain('["benchmark", runBenchmarkFilter.value]');
    expect(body).toContain('id="run-model-filter"');
    expect(body).toContain('id="run-duration-filter"');
    expect(body).toContain('id="run-triggered-filter"');
    expect(body).toContain('id="run-status-filter"');
    expect(body).toContain('id="run-quality-filter"');
    expect(body).toContain('id="hide-canary-runs" type="checkbox" checked');
    expect(body).toContain("Hide canary runs");
    expect(body).toContain('id="show-disabled-runs" type="checkbox"');
    expect(body).toContain("Show disabled runs");
    expect(body).toContain(
      'showDisabled: showDisabledRuns.checked ? "1" : "0"'
    );
    expect(body).toContain('run.disabled ? "Enable run" : "Disable run"');
    expect(body).toContain('run.status !== "running"');
    expect(body).toContain('hideCanary: hideCanaryRuns.checked ? "1" : "0"');
    expect(body).toContain('["durationGt", runDurationFilter.value.trim()]');
    expect(body).toContain('["qualityLt", runQualityFilter.value.trim()]');
    expect(body).toContain('" of " + runTotal + " runs"');
    expect(body).toContain('id="run-pagination"');
    expect(body).toContain('id="previous-run-page"');
    expect(body).toContain('id="next-run-page"');
    expect(body).toContain("pageSize: String(runPageSize)");
    expect(body).toContain('view: "page"');
    expect(body).toContain("scheduleRunFilterReload");
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
    expect(body).toContain("run-failure");
    expect(body).toContain("Failure reason");
    expect(body).toContain('run.status === "failed" && run.failureReason');
    expect(body).not.toContain("No failure reason was recorded");
    expect(body).toContain("% complete");
    expect(body).not.toContain("Evaluations completed");
    expect(body).not.toContain("Evaluations skipped");
    expect(body).toContain("Completed:");
    expect(body).toContain("Duration:");
    expect(body).toContain("Epochs:");
    expect(body).toContain("Concurrency:");
    expect(body).toContain("Limit:");
    expect(body).toContain("Benchmark:");
    expect(body).toContain("openModelHistory");
    expect(body).toContain("modelExact");
    expect(body).toContain("canaryOnly");
    expect(body).toContain('fullSuiteOnly: "1"');
    expect(body).toContain('id="model-history-drawer"');
    expect(body).toContain('id="model-history-benchmark"');
    expect(body).toContain(
      'value="tau_bench_verified_airline">TAU Airline</option>'
    );
    expect(body).toContain('value="deep_swe">Deep SWE</option>');
    expect(body).toContain(
      'value="swe_bench_verified">SWE-bench Verified</option>'
    );
    expect(body).toContain(
      'value="terminal_bench">Terminal-Bench 2.1</option>'
    );
    expect(body).toContain('value="swe_atlas_qa">SWE Atlas QA</option>');
    expect(body).toContain(
      'value="swe_atlas_tw">SWE Atlas Test Writing</option>'
    );
    expect(body).toContain(
      'value="swe_atlas_rf">SWE Atlas Refactoring</option>'
    );
    expect(body).toContain("Include non-canary runs");
    expect(body).toContain("modelHistoryBenchmark.addEventListener");
    expect(body).toContain("model-history-delta");
    expect(body).toContain("formatDuration(run.startedAt, run.finishedAt)");
    expect(body).toContain("<th>Started</th>");
    expect(body).toContain("<th>Duration</th>");
    expect(body).toContain("min(640px, 100vw)");
    expect(body).toContain("const response = await api(path)");
    expect(body).toContain("const payload = await response.json()");
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
    expect(body).toContain('value="deep_swe">Deep SWE');
    expect(body).toContain('value="swe_bench_verified">SWE-bench Verified');
    expect(body).toContain('value="terminal_bench">Terminal-Bench 2.1');
    expect(body).toContain('value="swe_atlas_qa">SWE Atlas QA');
    expect(body).toContain('value="swe_atlas_tw">SWE Atlas Test Writing');
    expect(body).toContain('value="swe_atlas_rf">SWE Atlas Refactoring');
    expect(body).toContain('id="swe-atlas-judge-model-label" hidden');
    expect(body).toContain('id="swe-atlas-judge-model" name="judgeModel"');
    expect(body).toContain('list="swe-atlas-judge-model-options"');
    expect(body).toContain('id="swe-atlas-judge-model-options"');
    expect(body).toContain("configureJudgeModelControls");
    expect(body).toContain("judgeCatalogModels.has(sweAtlasJudgeModel.value)");
    expect(body).toContain(
      "Runs through https://inference.do-ai.run/v1 using the server-configured judge key."
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
    expect(body).toContain(
      'name="epochs" type="number" min="1" max="20" value="3"'
    );
    expect(body).toContain(
      'name="concurrency" type="number" min="1" max="64" value="3"'
    );
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
    expect(body).toContain('targetDocument.execCommand("copy")');
    expect(body).toContain("targetDocument.defaultView?.navigator.clipboard");
    expect(body).toContain('runId.className = "run-id"');
    expect(body).toContain('copy.textContent = "⧉"');
    expect(body).toContain('copy.title = "Copy run link"');
    expect(body).not.toContain('view.textContent = "Details"');
    expect(body).toContain("runId === null");
    expect(body).toContain("? paginatedRunsPath()");
    expect(body).toContain('name="maxTokens"');
    expect(body).toContain('name="temperature"');
    expect(body).toContain('value="high" selected');
    expect(body).toContain('name="reasoningEffort"');
    expect(body).toContain('name="timeoutMs"');
    expect(body).toContain('name="completionTimeoutMs"');
    expect(body).toContain('value="3600000"');
    expect(body).toContain("Defaults to one hour per attempt");
    expect(body).toContain(
      '<input name="limit" type="number" min="1" max="1000" placeholder="All questions">'
    );
    expect(body).toContain('name="sort"');
    expect(body).toContain('id="openrouter-provider-label" hidden');
    expect(body).toContain(
      '<option value="digitalocean">DigitalOcean only</option>'
    );
    expect(body).toContain('id="openrouter-fallbacks-label"');
    expect(body).toContain("openrouterProviderLabel.hidden = !isOpenRouter");
    expect(body).toContain(
      'inferenceBaseUrl.value === "https://openrouter.ai/api/v1"'
    );
    expect(body).toContain("{ providerOnly: [providerOnly] }");
    expect(body).toContain(
      '{ allowFallbacks: data.get("allowFallbacks") === "on" }'
    );
    expect(body).toContain('name="cloudflareVersion"');
    expect(body).toContain('name="costQualityTradeoff"');
    expect(body).toContain('name="pinModel"');
    expect(body).toContain('name="maxRetries"');
    expect(body).toContain("applyBenchmarkDefaults");
    expect(body).toContain(
      'startBenchmark.value === "tau_bench_verified_airline"'
    );
    expect(body).toContain('startBenchmark.value === "deep_swe"');
    expect(body).toContain('startBenchmark.value === "swe_bench_verified"');
    expect(body).toContain('startBenchmark.value === "terminal_bench"');
    expect(body).toContain("isSweAtlasBenchmark(startBenchmark.value)");
    expect(body).toContain('benchmark === "swe_atlas_tw"');
    expect(body).toContain('benchmark === "swe_atlas_rf"');
    expect(body).toContain("sweAtlasJudgeModelLabel.hidden = !isSweAtlas");
    expect(body).toContain("sweAtlasJudgeModel.disabled = !isSweAtlas");
    expect(body).toContain("sweAtlasJudgeModel.required = isSweAtlas");
    expect(body).toContain('benchmark === "swe_atlas_qa"');
    expect(body).toContain('judgeModel !== "" && { judgeModel }');
    expect(body).toContain('["Judge model", run.args.judgeModel]');
    expect(body).toContain(
      'temperature.value = isTau || isSandboxBenchmark ? "0" : "1"'
    );
    expect(body).toContain('epochs.value = isSandboxBenchmark ? "1" : "3"');
    expect(body).toContain(
      'concurrency.value = isSandboxBenchmark ? "1" : "3"'
    );
    expect(body).toContain('concurrency.max = isSandboxBenchmark ? "6" : "64"');
    expect(body).toContain('benchmark !== "gpqa_diamond"');
    expect(body).toContain('benchmark !== "tau_bench_verified_airline"');
    expect(body).toContain("epochs > 1");
    expect(body).toContain(
      "more than one epoch can take a long time to finish and is not recommended"
    );
    expect(body).toContain("TAU user simulator default: gemini-2.5-flash");
    expect(body).toContain(
      '...(temperature === "" ? {} : { temperature: Number(temperature) })'
    );
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
    const reportUnauthorized = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/gpqa-report`)
    );
    const tauReportUnauthorized = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/tau-airline-report`)
    );
    const retryUnauthorized = await handleRequest(
      new Request(
        `http://localhost/runs/${metadata.id}/diagnostic-retries/retry-id`
      )
    );
    const campaignUnauthorized = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/gpqa-retry-comparisons`)
    );
    const runsAuthorized = await handleRequest(
      new Request("http://localhost/runs", {
        headers: { Authorization: "Bearer test-token" },
      })
    );
    const paginatedRunsAuthorized = await handleRequest(
      new Request("http://localhost/runs?view=page&page=1&pageSize=50", {
        headers: { Authorization: "Bearer test-token" },
      })
    );
    const filteredRunsAuthorized = await handleRequest(
      new Request(
        "http://localhost/runs?view=page&page=1&pageSize=50&status=failed",
        { headers: { Authorization: "Bearer test-token" } }
      )
    );

    expect(runsUnauthorized.status).toBe(401);
    expect(logsUnauthorized.status).toBe(401);
    expect(requestsUnauthorized.status).toBe(401);
    expect(stateUnauthorized.status).toBe(401);
    expect(parquetUnauthorized.status).toBe(401);
    expect(summaryUnauthorized.status).toBe(401);
    expect(reportUnauthorized.status).toBe(401);
    expect(tauReportUnauthorized.status).toBe(401);
    expect(retryUnauthorized.status).toBe(401);
    expect(campaignUnauthorized.status).toBe(401);
    expect(runsAuthorized.status).toBe(200);
    expect(await runsAuthorized.json()).toEqual([metadata]);
    expect(await paginatedRunsAuthorized.json()).toMatchObject({
      runs: [metadata],
      page: 1,
      pageSize: 50,
      total: 1,
      totalPages: 1,
      summary: { total: 1 },
    });
    expect(await filteredRunsAuthorized.json()).toMatchObject({
      runs: [],
      page: 1,
      total: 0,
      totalPages: 1,
      summary: { total: 0, running: 0, failed: 0 },
    });
  });

  it("supports exact model, canary-only, and full-suite paginated filters", async () => {
    const canary = {
      ...metadata,
      id: "00000000-0000-4000-8000-000000000002",
      args: {
        ...metadata.args,
        inference: {
          ...metadata.args.inference,
          model: "provider/model-canary",
        },
      },
      triggeredByEmail: "genai-temporal-worker@digitalocean.com",
    };
    const otherModel = {
      ...metadata,
      id: "00000000-0000-4000-8000-000000000003",
      args: {
        ...metadata.args,
        inference: {
          ...metadata.args.inference,
          model: "provider/model-extra",
        },
      },
    };
    const fullGpqa = {
      ...metadata,
      id: "00000000-0000-4000-8000-000000000004",
      args: {
        ...metadata.args,
        execution: {
          epochs: 3,
          concurrency: 3,
          unordered: true,
        },
      },
      expectedQuestions: 198,
      totalEvaluations: 594,
    };
    const fullTau = {
      ...metadata,
      id: "00000000-0000-4000-8000-000000000005",
      args: {
        ...metadata.args,
        benchmark: "tau_bench_verified_airline" as const,
        execution: {
          epochs: 3,
          concurrency: 3,
          unordered: true,
          limit: 50,
        },
      },
      expectedQuestions: 50,
      totalEvaluations: 150,
    };
    const partialTau = {
      ...fullTau,
      id: "00000000-0000-4000-8000-000000000006",
      args: {
        ...fullTau.args,
        execution: {
          epochs: 1,
          concurrency: 1,
          unordered: true,
          limit: 5,
        },
      },
      expectedQuestions: 5,
      totalEvaluations: 5,
    };
    const store: RunMetadataStore = {
      upsert: () => Promise.resolve(),
      setDisabled: () => Promise.resolve(),
      get: () => Promise.resolve(metadata),
      list: () =>
        Promise.resolve([
          metadata,
          canary,
          otherModel,
          fullGpqa,
          fullTau,
          partialTau,
        ]),
    };
    configureRunMetadataStore(store);

    const exactModel = await handleRequest(
      new Request(
        "http://localhost/runs?view=page&page=1&pageSize=50&model=provider%2Fmodel&modelExact=1",
        { headers: { Authorization: "Bearer test-token" } }
      )
    );
    const substringModel = await handleRequest(
      new Request(
        "http://localhost/runs?view=page&page=1&pageSize=50&model=provider%2Fmodel",
        { headers: { Authorization: "Bearer test-token" } }
      )
    );
    const canaryOnly = await handleRequest(
      new Request(
        "http://localhost/runs?view=page&page=1&pageSize=50&canaryOnly=1",
        { headers: { Authorization: "Bearer test-token" } }
      )
    );
    const fullSuiteOnly = await handleRequest(
      new Request(
        "http://localhost/runs?view=page&page=1&pageSize=50&fullSuiteOnly=1",
        { headers: { Authorization: "Bearer test-token" } }
      )
    );

    expect(exactModel.status).toBe(200);
    expect(await exactModel.json()).toMatchObject({
      total: 4,
      runs: [
        { id: metadata.id },
        { id: fullGpqa.id },
        { id: fullTau.id },
        { id: partialTau.id },
      ],
    });
    expect(await substringModel.json()).toMatchObject({
      total: 6,
    });
    expect(await canaryOnly.json()).toMatchObject({
      total: 1,
      runs: [{ id: canary.id }],
    });
    expect(await fullSuiteOnly.json()).toMatchObject({
      total: 2,
      runs: [{ id: fullGpqa.id }, { id: fullTau.id }],
    });
  });

  it("includes the precomputed performance report on run details only", async () => {
    performanceReports.set(metadata.id, {
      runId: metadata.id,
      schemaVersion: 1,
      computedAt: "2026-08-14T10:06:30.000Z",
      status: "complete",
      error: null,
      report: {
        schemaVersion: 1,
        runId: metadata.id,
        computedAt: "2026-08-14T10:06:30.000Z",
        status: "succeeded",
        requestPerf: {
          requestCount: 2,
          completedCount: 2,
          pendingCount: 0,
          successfulCount: 1,
          errorCount: 1,
          retryAttemptCount: 1,
          postProcessingFailureCount: 0,
          successRate: 0.5,
          errorRate: 0.5,
          retryAttemptRate: 0.5,
          postProcessingFailureRate: 0,
          latencyMs: {
            sampleSize: 2,
            p50: 1000,
            p75: 1250,
            p90: 1400,
            p95: 1450,
            mean: 1250,
            max: 1500,
          },
          observedWindowMs: 2000,
          peakInFlight: 2,
          averageInFlight: 1.25,
          throughputPerMinute: 60,
          outputTokensTotal: 10,
          outputTokenDurationMs: 1000,
          effectiveOutputTokensPerSecond: 10,
          errorStatusCounts: [{ status: "429", count: 1 }],
        },
        gpqa: null,
      },
    });

    const details = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}`, {
        headers: { Authorization: "Bearer test-token" },
      })
    );
    const listed = await handleRequest(
      new Request("http://localhost/runs", {
        headers: { Authorization: "Bearer test-token" },
      })
    );

    expect(details.status).toBe(200);
    expect(await details.json()).toMatchObject({
      id: metadata.id,
      performanceReport: {
        status: "complete",
        report: {
          requestPerf: {
            requestCount: 2,
            errorStatusCounts: [{ status: "429", count: 1 }],
          },
        },
      },
    });
    expect(await listed.json()).toEqual([metadata]);
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

  it("requires the run trigger password for diagnostic retries", async () => {
    const response = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/diagnostic-retries`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
          "X-Bench-Run-Secret": "wrong",
        },
        body: JSON.stringify({
          sampleId: "gpqa_diamond-0",
          originalEpoch: 0,
          apiKey: "sk-test",
        }),
      })
    );

    expect(response.status).toBe(403);
  });

  it("rejects diagnostic retries for Deep SWE", async () => {
    const deepMetadata = {
      ...metadata,
      args: {
        ...metadata.args,
        benchmark: "deep_swe" as const,
      },
    };
    configureRunMetadataStore({
      upsert: () => Promise.resolve(),
      setDisabled: () => Promise.resolve(),
      get: () => Promise.resolve(deepMetadata),
      list: () => Promise.resolve([deepMetadata]),
    });

    const response = await handleRequest(
      new Request(`http://localhost/runs/${metadata.id}/diagnostic-retries`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
          "X-Bench-Run-Secret": "trigger-password",
        },
        body: JSON.stringify({
          sampleId: "deep_swe-task",
          originalEpoch: 0,
          apiKey: "sk-test",
        }),
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "diagnostic retries are not supported for deep_swe",
    });
  });

  it("requires the run trigger password for GPQA retry comparisons", async () => {
    const response = await handleRequest(
      new Request(
        `http://localhost/runs/${metadata.id}/gpqa-retry-comparisons`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
            "X-Bench-Run-Secret": "wrong",
          },
          body: "{}",
        }
      )
    );

    expect(response.status).toBe(403);
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

    const disableBody = await disable.json();
    const enableBody = await enable.json();
    expect(disable.status).toBe(200);
    expect(disableBody.disabled).toBe(true);
    expect(enable.status).toBe(200);
    expect(enableBody.disabled).toBe(false);
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
    const parquetBytes = runResultToParquet({
      result: {
        metrics: {
          accuracy: 1,
          totalQuestions: 1,
          correctAnswers: 1,
          skippedQuestions: 0,
        },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          reasoningTokens: 2,
          totalCost: 0.01,
          generationTimeMs: 100,
        },
        sampleScores: [
          {
            sampleId: "gpqa_diamond-0",
            epoch: 0,
            score: {
              value: ScoreValue.Correct,
              answer: "B",
              explanation: "Extracted 'B' from response, target was 'B'",
            },
            input: "Question\n\nA) One\nB) Two\nC) Three\nD) Four",
            target: "B",
            messages: [
              { role: MessageRole.User, content: "Question" },
              {
                role: MessageRole.Assistant,
                content: "Answer: B",
                reasoning: "Two is correct.",
              },
            ],
            metadata: { subdomain: "Physics" },
          },
        ],
      },
      meta: {
        task: "gpqa_diamond",
        model: "provider/model",
        epochs: 1,
        temperature: 0.5,
      },
    });
    writeFileSync(logPath, "running\n");
    writeFileSync(requestLogPath, '{"event":"started"}\n');
    writeFileSync(statePath, '{"status":"running"}\n');
    writeFileSync(parquetPath, parquetBytes);
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
    const requestTail = requestRecordsResponse(record, '{"event":'.length);
    const requestsDownload = requestRecordsDownloadResponse(record);
    const state = runStateResponse(record);
    const stateDownload = runStateResponse(record, true);
    const parquet = parquetResponse(record);
    const report = await gpqaReportResponse(record, true);

    expect(await logsDownload.text()).toBe("running\n");
    expect(logsDownload.headers.get("content-disposition")).toContain(
      `${record.id}-run.log`
    );
    expect(await requests.text()).toBe('{"event":"started"}\n');
    expect(requests.headers.get("content-type")).toContain(
      "application/x-ndjson"
    );
    expect(requests.headers.get("x-request-log-next-offset")).toBe(
      String(Buffer.byteLength('{"event":"started"}\n'))
    );
    expect(await requestTail.text()).toBe('"started"}\n');
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
    expect(new Uint8Array(await parquet.arrayBuffer()).subarray(0, 4)).toEqual(
      new Uint8Array([80, 65, 82, 49])
    );
    expect(report.headers.get("content-disposition")).toContain(
      `${record.id}-gpqa-report.json`
    );
    expect(await report.json()).toMatchObject({
      runId: record.id,
      model: "provider/model",
      inference: {
        baseUrl: "https://inference.example.com/v1",
        model: "provider/model",
        temperature: 0.5,
      },
      correct: 1,
      incorrect: 0,
      wrong: 0,
      noAnswer: 0,
      skipped: 0,
      analytics: {
        epochConsistency: {
          questions: 1,
          singleObservation: 1,
        },
      },
      items: [
        {
          sampleId: "gpqa_diamond-0",
          status: "correct",
          modelAnswer: "Answer: B",
          correctAnswer: "B",
          correctAnswerText: "Two",
          reasoning: "Two is correct.",
        },
      ],
    });

    mkdirSync(join(artifactDirectory, "reports"), { recursive: true });
    writeFileSync(
      join(artifactDirectory, "reports", "gpqa-report.json"),
      JSON.stringify({
        runId: record.id,
        file: "precomputed.parquet",
        inference: record.args.inference,
        task: "gpqa_diamond",
        model: "provider/model",
        totalGenerationTimeMs: 1,
        evaluations: 1,
        correct: 1,
        incorrect: 0,
        wrong: 0,
        noAnswer: 0,
        skipped: 0,
        items: [],
        analytics: { epochConsistency: { questions: 0 } },
      })
    );
    const precomputed = await gpqaReportResponse(record);
    expect(await precomputed.json()).toMatchObject({
      file: "precomputed.parquet",
      items: [],
    });
  });
});
