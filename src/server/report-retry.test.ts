import { describe, expect, it } from "bun:test";

import {
  diagnosticRetryArgv,
  diagnosticRetryRunArgs,
  getReportRetry,
  startReportRetry,
  supportsReportRetry,
} from "./report-retry";
import type { RunArgs } from "./run-registry";

const ARGS: RunArgs = {
  benchmark: "gpqa_diamond",
  triggeredByEmail: "user@digitalocean.com",
  inference: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-v4-flash-0731",
    temperature: 1,
    maxTokens: 8192,
    reasoningEffort: "high",
    timeoutMs: 120_000,
    completionTimeoutMs: 1_800_000,
    providerOnly: ["digitalocean"],
    allowFallbacks: false,
  },
  execution: {
    epochs: 3,
    concurrency: 8,
    unordered: true,
    start: 10,
    limit: 20,
    maxRetries: 6,
  },
};

describe("diagnostic report retries", () => {
  it("reuses inference config but runs exactly one selected sample", () => {
    const retryArgs = diagnosticRetryRunArgs(ARGS);
    const argv = diagnosticRetryArgv(ARGS, "gpqa_diamond-12");
    const solverConfigIndex = argv.indexOf("--solver-config");

    expect(retryArgs.inference).toEqual(ARGS.inference);
    expect(retryArgs.execution).toEqual({
      epochs: 1,
      concurrency: 1,
      unordered: false,
      maxRetries: 6,
    });
    for (const value of [
      "--epochs",
      "1",
      "--concurrency",
      "--sample-id",
      "gpqa_diamond-12",
    ]) {
      expect(argv).toContain(value);
    }
    expect(JSON.parse(argv[solverConfigIndex + 1] ?? "{}")).toMatchObject({
      maxTokens: 8192,
      reasoningEffort: "high",
      timeoutMs: 120_000,
      completionTimeoutMs: 1_800_000,
      providerOnly: ["digitalocean"],
      allowFallbacks: false,
      maxRetries: 6,
    });
  });

  it("does not expose retries under another run id", () => {
    expect(getReportRetry("run-a", "missing")).toBeUndefined();
  });

  it("rejects Deep SWE instead of treating it as a TAU report", () => {
    const deepSweArgs: RunArgs = {
      ...ARGS,
      benchmark: "deep_swe",
    };

    expect(supportsReportRetry("deep_swe")).toBe(false);
    expect(() =>
      startReportRetry({
        runId: "deep-run",
        args: deepSweArgs,
        sampleId: "deep_swe-task",
        originalEpoch: 0,
        apiKey: "secret",
      })
    ).toThrow("Diagnostic retries are not supported for deep_swe");
  });
});
