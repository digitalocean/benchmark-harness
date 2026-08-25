import { afterEach, describe, expect, it } from "bun:test";

import type { RunArgs } from "./run-registry";
import {
  buildArgv,
  childEnvironment,
  resolveFinishedRunStatus,
} from "./run-registry";

const originalSpacesSecret = process.env["SPACES_SECRET_ACCESS_KEY"];
const originalApiToken = process.env["BENCH_API_TOKEN"];
const originalTriggerSecret = process.env["BENCH_RUN_TRIGGER_SECRET"];
const originalMysqlPassword = process.env["MYSQL_PASSWORD"];

afterEach(() => {
  process.env["SPACES_SECRET_ACCESS_KEY"] = originalSpacesSecret;
  process.env["BENCH_API_TOKEN"] = originalApiToken;
  process.env["BENCH_RUN_TRIGGER_SECRET"] = originalTriggerSecret;
  process.env["MYSQL_PASSWORD"] = originalMysqlPassword;
});

function args(): RunArgs {
  return {
    benchmark: "gpqa_diamond",
    inference: {
      baseUrl: "https://inference.example.com/v1",
      model: "provider/model",
      temperature: 0.5,
      maxTokens: 4096,
      reasoningEffort: "high",
      timeoutMs: 60_000,
      endpointId: "endpoint-1",
      costTier: "high",
      sort: "throughput",
      cloudflareVersion: "version-1",
      costQualityTradeoff: 7,
      pinModel: true,
    },
    execution: {
      epochs: 5,
      concurrency: 8,
      unordered: true,
      start: 10,
      limit: 20,
      maxRetries: 4,
    },
  };
}

describe("GPQA child invocation", () => {
  it("maps every payload option to CLI arguments", () => {
    const argv = buildArgv(args());
    const expectedArgs = [
      "--benchmark",
      "gpqa_diamond",
      "--model",
      "provider/model",
      "--epochs",
      "5",
      "--concurrency",
      "8",
      "--unordered",
      "--start",
      "10",
      "--limit",
      "20",
    ];
    for (const expected of expectedArgs) {
      expect(argv).toContain(expected);
    }
    const solverConfigIndex = argv.indexOf("--solver-config");
    expect(solverConfigIndex).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(argv[solverConfigIndex + 1] ?? "{}")).toEqual({
      maxTokens: 4096,
      reasoningEffort: "high",
      timeoutMs: 60_000,
      endpointId: "endpoint-1",
      costTier: "high",
      sort: "throughput",
      cloudflareVersion: "version-1",
      costQualityTradeoff: 7,
      pinModel: true,
      maxRetries: 4,
    });
  });

  it("builds a TAU airline child invocation", () => {
    const tauArgs: RunArgs = {
      ...args(),
      benchmark: "tau_bench_verified_airline",
      inference: {
        ...args().inference,
        temperature: 0,
      },
    };

    const argv = buildArgv(tauArgs);
    expect(argv).toContain("--benchmark");
    expect(argv).toContain("tau_bench_verified_airline");
  });

  it("injects the payload inference secret only into the child", () => {
    process.env["SPACES_SECRET_ACCESS_KEY"] = "spaces-secret";
    process.env["BENCH_API_TOKEN"] = "api-token";
    process.env["BENCH_RUN_TRIGGER_SECRET"] = "trigger-secret";
    process.env["MYSQL_PASSWORD"] = "mysql-secret";

    const env = childEnvironment(
      args(),
      "resolved-secret",
      "run-id",
      "logs/api/run-id/requests/requests.jsonl",
      "logs/api/run-id/results"
    );

    expect(env["OPENROUTER_API_KEY"]).toBe("resolved-secret");
    expect(env["OPENROUTER_BASE_URL"]).toBe("https://inference.example.com/v1");
    expect(env["BENCH_CHILD_WORKFLOW_ID"]).toBe("run-id");
    expect(env["BENCH_PROGRESS_FILE"]).toBe("logs/api/run-id/progress.json");
    expect(env["REQUEST_LOG_FILE"]).toBe(
      "logs/api/run-id/requests/requests.jsonl"
    );
    expect(env["SPACES_SECRET_ACCESS_KEY"]).toBeUndefined();
    expect(env["BENCH_API_TOKEN"]).toBeUndefined();
    expect(env["BENCH_RUN_TRIGGER_SECRET"]).toBeUndefined();
    expect(env["MYSQL_PASSWORD"]).toBeUndefined();
  });
});

describe("benchmark completion status", () => {
  it("treats a complete valid Parquet as success without an exit code", () => {
    expect(
      resolveFinishedRunStatus({
        failedForMetadata: false,
        cancelRequested: false,
        exitCode: null,
        hasCompleteParquet: true,
      })
    ).toBe("succeeded");
  });

  it("keeps metadata failure and cancellation authoritative", () => {
    expect(
      resolveFinishedRunStatus({
        failedForMetadata: true,
        cancelRequested: false,
        exitCode: 0,
        hasCompleteParquet: true,
      })
    ).toBe("failed");
    expect(
      resolveFinishedRunStatus({
        failedForMetadata: false,
        cancelRequested: true,
        exitCode: 0,
        hasCompleteParquet: true,
      })
    ).toBe("cancelled");
  });
});
