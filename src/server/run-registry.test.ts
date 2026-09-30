import { afterEach, describe, expect, it } from "bun:test";

import type { RunArgs } from "./run-registry";
import {
  buildArgv,
  childEnvironment,
  hasCompleteEvaluationResults,
  resolveFinishedRunFailureReason,
  resolveFinishedRunStatus,
} from "./run-registry";

const originalSpacesSecret = process.env["SPACES_SECRET_ACCESS_KEY"];
const originalApiToken = process.env["BENCH_API_TOKEN"];
const originalTriggerSecret = process.env["BENCH_RUN_TRIGGER_SECRET"];
const originalMysqlPassword = process.env["MYSQL_PASSWORD"];
const originalSweAtlasJudgeKey = process.env["SWE_ATLAS_JUDGE_API_KEY"];
const originalSweAtlasJudgeBaseUrl = process.env["SWE_ATLAS_JUDGE_BASE_URL"];
const originalSweAtlasJudgeModel = process.env["SWE_ATLAS_JUDGE_MODEL"];

afterEach(() => {
  process.env["SPACES_SECRET_ACCESS_KEY"] = originalSpacesSecret;
  process.env["BENCH_API_TOKEN"] = originalApiToken;
  process.env["BENCH_RUN_TRIGGER_SECRET"] = originalTriggerSecret;
  process.env["MYSQL_PASSWORD"] = originalMysqlPassword;
  process.env["SWE_ATLAS_JUDGE_API_KEY"] = originalSweAtlasJudgeKey;
  process.env["SWE_ATLAS_JUDGE_BASE_URL"] = originalSweAtlasJudgeBaseUrl;
  process.env["SWE_ATLAS_JUDGE_MODEL"] = originalSweAtlasJudgeModel;
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
      completionTimeoutMs: 1_800_000,
      endpointId: "endpoint-1",
      costTier: "high",
      sort: "throughput",
      providerOnly: ["digitalocean"],
      allowFallbacks: false,
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
      temperature: 0.5,
      maxTokens: 4096,
      reasoningEffort: "high",
      timeoutMs: 60_000,
      completionTimeoutMs: 1_800_000,
      endpointId: "endpoint-1",
      costTier: "high",
      sort: "throughput",
      providerOnly: ["digitalocean"],
      allowFallbacks: false,
      cloudflareVersion: "version-1",
      costQualityTradeoff: 7,
      pinModel: true,
      maxRetries: 4,
    });
  });

  it("passes every selected retry-campaign sample to the CLI", () => {
    const argv = buildArgv({
      ...args(),
      sampleIds: ["gpqa_diamond-1", "gpqa_diamond-9"],
    });
    expect(argv.filter((value) => value === "--sample-id")).toHaveLength(2);
    expect(argv).toContain("gpqa_diamond-1");
    expect(argv).toContain("gpqa_diamond-9");
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

  it("builds a Terminal-Bench child invocation with execution controls", () => {
    const terminalArgs: RunArgs = {
      ...args(),
      benchmark: "terminal_bench",
      inference: {
        ...args().inference,
        temperature: 0,
      },
      execution: {
        ...args().execution,
        epochs: 2,
        concurrency: 4,
        limit: 10,
      },
    };

    const argv = buildArgv(terminalArgs);
    expect(argv).toContain("terminal_bench");
    expect(
      argv.slice(argv.indexOf("--epochs"), argv.indexOf("--epochs") + 2)
    ).toEqual(["--epochs", "2"]);
    expect(
      argv.slice(
        argv.indexOf("--concurrency"),
        argv.indexOf("--concurrency") + 2
      )
    ).toEqual(["--concurrency", "4"]);
    expect(
      argv.slice(argv.indexOf("--limit"), argv.indexOf("--limit") + 2)
    ).toEqual(["--limit", "10"]);
  });

  it("builds SWE Atlas child invocations for every track", () => {
    const atlasArgs: RunArgs = {
      ...args(),
      benchmark: "swe_atlas_qa",
      judgeModel: "judge/model",
      inference: {
        ...args().inference,
        temperature: 0,
      },
      execution: {
        ...args().execution,
        epochs: 1,
        concurrency: 2,
        limit: 5,
      },
    };

    const argv = buildArgv(atlasArgs);
    expect(argv).toContain("swe_atlas_qa");
    expect(
      argv.slice(argv.indexOf("--epochs"), argv.indexOf("--epochs") + 2)
    ).toEqual(["--epochs", "1"]);
    expect(
      argv.slice(
        argv.indexOf("--concurrency"),
        argv.indexOf("--concurrency") + 2
      )
    ).toEqual(["--concurrency", "2"]);
    expect(
      argv.slice(argv.indexOf("--limit"), argv.indexOf("--limit") + 2)
    ).toEqual(["--limit", "5"]);
    const solverConfigIndex = argv.indexOf("--solver-config");
    expect(JSON.parse(argv[solverConfigIndex + 1] ?? "{}").judgeModel).toBe(
      "judge/model"
    );
    for (const benchmark of ["swe_atlas_tw", "swe_atlas_rf"] as const) {
      const trackArgv = buildArgv({ ...atlasArgs, benchmark });
      expect(trackArgv).toContain(benchmark);
      const trackSolverConfigIndex = trackArgv.indexOf("--solver-config");
      expect(
        JSON.parse(trackArgv[trackSolverConfigIndex + 1] ?? "{}").judgeModel
      ).toBe("judge/model");
    }
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

  it("injects SWE Atlas judge credentials only into Atlas children", () => {
    process.env["SWE_ATLAS_JUDGE_API_KEY"] = "judge-secret";
    process.env["SWE_ATLAS_JUDGE_BASE_URL"] = "https://judge.example/v1";
    process.env["SWE_ATLAS_JUDGE_MODEL"] = "judge/model";
    const gpqaEnv = childEnvironment(
      args(),
      "inference-secret",
      "gpqa-run",
      "requests.jsonl",
      "results"
    );

    for (const benchmark of [
      "swe_atlas_qa",
      "swe_atlas_tw",
      "swe_atlas_rf",
    ] as const) {
      const atlasEnv = childEnvironment(
        { ...args(), benchmark },
        "inference-secret",
        "atlas-run",
        "requests.jsonl",
        "results"
      );
      expect(atlasEnv["SWE_ATLAS_JUDGE_API_KEY"]).toBe("judge-secret");
      expect(atlasEnv["SWE_ATLAS_JUDGE_BASE_URL"]).toBe(
        "https://inference.do-ai.run/v1"
      );
      expect(atlasEnv["SWE_ATLAS_JUDGE_MODEL"]).toBeUndefined();
    }
    expect(gpqaEnv["SWE_ATLAS_JUDGE_API_KEY"]).toBeUndefined();
    expect(gpqaEnv["SWE_ATLAS_JUDGE_BASE_URL"]).toBeUndefined();
    expect(gpqaEnv["SWE_ATLAS_JUDGE_MODEL"]).toBeUndefined();
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
        hasExcessiveSkips: false,
      })
    ).toBe("succeeded");
  });

  it("treats a complete valid Parquet with some skipped rows as success", () => {
    const hasCompleteParquet = hasCompleteEvaluationResults({
      hasValidParquet: true,
      completedEvaluations: 111,
      skippedEvaluations: 2,
      totalEvaluations: 113,
    });

    expect(hasCompleteParquet).toBe(true);
    expect(
      resolveFinishedRunStatus({
        failedForMetadata: false,
        cancelRequested: false,
        exitCode: null,
        hasCompleteParquet,
        hasExcessiveSkips: false,
      })
    ).toBe("succeeded");
  });

  it("fails when skipped evaluations exceed completed evaluations", () => {
    expect(
      resolveFinishedRunStatus({
        failedForMetadata: false,
        cancelRequested: false,
        exitCode: 0,
        hasCompleteParquet: true,
        hasExcessiveSkips: true,
      })
    ).toBe("failed");

    expect(
      resolveFinishedRunFailureReason({
        status: "failed",
        exitCode: null,
        logTail:
          '{"level":"error","message":"Recovered benchmark process stopped without an observable exit code"}',
        resultIssue: null,
        completedEvaluations: 2,
        skippedEvaluations: 3,
        totalEvaluations: 5,
      })
    ).toBe(
      "The benchmark run failed because skipped evaluations (3) exceeded completed evaluations (2), out of 5 total evaluations. Review the skipped sample explanations in the run report for the underlying errors."
    );
  });

  it("keeps metadata failure and cancellation authoritative", () => {
    expect(
      resolveFinishedRunStatus({
        failedForMetadata: true,
        cancelRequested: false,
        exitCode: 0,
        hasCompleteParquet: true,
        hasExcessiveSkips: false,
      })
    ).toBe("failed");
    expect(
      resolveFinishedRunStatus({
        failedForMetadata: false,
        cancelRequested: true,
        exitCode: 0,
        hasCompleteParquet: true,
        hasExcessiveSkips: false,
      })
    ).toBe("cancelled");
  });

  it("extracts an explicit child failure for durable metadata", () => {
    expect(
      resolveFinishedRunFailureReason({
        status: "failed",
        exitCode: 1,
        logTail:
          "Running benchmark...\nBenchmark failed: SolverError: user simulator rejected the request\n",
        resultIssue: "No Parquet result file was created",
        completedEvaluations: 49,
        skippedEvaluations: 0,
        totalEvaluations: 50,
      })
    ).toBe("SolverError: user simulator rejected the request");
  });

  it("describes abrupt and OOM process termination without child logs", () => {
    const abrupt = resolveFinishedRunFailureReason({
      status: "failed",
      exitCode: null,
      logTail: "Running benchmark...\n",
      resultIssue: "No Parquet result file was created",
      completedEvaluations: 50,
      skippedEvaluations: 0,
      totalEvaluations: 50,
    });
    const oom = resolveFinishedRunFailureReason({
      status: "failed",
      exitCode: 137,
      logTail: "",
      resultIssue: "No Parquet result file was created",
      completedEvaluations: 50,
      skippedEvaluations: 0,
      totalEvaluations: 50,
    });

    expect(abrupt).toContain("without an observable exit code");
    expect(abrupt).toContain("OOM/SIGKILL");
    expect(oom).toContain("out-of-memory");
    expect(oom).toContain("exit code 137");
  });
});
