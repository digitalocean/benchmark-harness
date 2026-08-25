import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildBenchmarkConfig,
  parseArgs,
  tauAirlineUserSimulatorFromEnv,
  writeProgress,
} from ".";
describe("bench-harness CLI", () => {
  it("parses unordered concurrency as an opt-in flag", () => {
    expect(parseArgs(["--unordered"]).unordered).toBe(true);
    expect(parseArgs([]).unordered).toBe(false);
  });

  it("writes machine-readable evaluation progress", () => {
    const directory = mkdtempSync(join(tmpdir(), "bench-progress-"));
    const path = join(directory, "progress.json");
    const original = process.env["BENCH_PROGRESS_FILE"];
    try {
      process.env["BENCH_PROGRESS_FILE"] = path;
      writeProgress(3, 8, 1);
      expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
        processed: 3,
        completed: 2,
        skipped: 1,
        total: 8,
        percentage: 37.5,
      });
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(process.env, "BENCH_PROGRESS_FILE");
      } else {
        process.env["BENCH_PROGRESS_FILE"] = original;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("parses and forwards --cost-tier", () => {
    const args = parseArgs([
      "--benchmark",
      "gpqa_diamond",
      "--model",
      "openrouter/auto",
      "--cost-tier",
      "xhigh",
    ]);
    expect(
      buildBenchmarkConfig({
        benchmarkId: args.benchmark,
        model: args.model,
        panelConfig: undefined,
        artifactDir: undefined,
        endpointId: undefined,
        imageDetail: undefined,
        costTier: args.costTier,
      })
    ).toMatchObject({ costTier: "xhigh" });
  });

  it("rejects an invalid --cost-tier value", () => {
    expect(() => parseArgs(["--cost-tier", "invalid"])).toThrow(
      "--cost-tier must be one of"
    );
  });
  it("passes GPQA inference overrides through solver config", () => {
    const config = buildBenchmarkConfig({
      benchmarkId: "gpqa_diamond",
      model: "provider/model",
      panelConfig: {
        maxTokens: 4096,
        reasoningEffort: "high",
        timeoutMs: 60_000,
        maxRetries: 4,
        pinModel: true,
      },
      artifactDir: undefined,
      endpointId: "endpoint-1",
      imageDetail: undefined,
      costTier: "high",
    });
    expect(config).toMatchObject({
      benchmarkId: "gpqa_diamond",
      model: "provider/model",
      endpointId: "endpoint-1",
      maxTokens: 4096,
      reasoningEffort: "high",
      timeoutMs: 60_000,
      maxRetries: 4,
      pinModel: true,
      costTier: "high",
    });
  });
  it("passes tau3 retrieval config through the generic solver config", () => {
    const args = parseArgs([
      "--benchmark",
      "tau3_bench_banking",
      "--model",
      "openai/gpt-4o-mini",
      "--solver-config",
      '{"retrievalConfig":"bm25_grep"}',
    ]);
    const panelConfig: unknown = JSON.parse(args.solverConfig ?? "");
    const config = buildBenchmarkConfig({
      benchmarkId: args.benchmark,
      model: args.model,
      panelConfig,
      artifactDir: undefined,
      endpointId: undefined,
      imageDetail: undefined,
    });
    expect(config).toMatchObject({
      benchmarkId: "tau3_bench_banking",
      retrievalConfig: "bm25_grep",
    });
  });

  it("selects an ori agent harness for terminal_bench through the solver config", () => {
    const args = parseArgs([
      "--benchmark",
      "terminal_bench",
      "--model",
      "anthropic/claude-opus-5",
      "--solver-config",
      '{"agent":"claude"}',
    ]);
    const panelConfig: unknown = JSON.parse(args.solverConfig ?? "");
    const config = buildBenchmarkConfig({
      benchmarkId: args.benchmark,
      model: args.model,
      panelConfig,
      artifactDir: undefined,
      endpointId: undefined,
      imageDetail: undefined,
    });
    expect(config).toMatchObject({
      benchmarkId: "terminal_bench",
      agent: "claude",
    });
  });

  it("defaults terminal_bench to the pi agent", () => {
    const config = buildBenchmarkConfig({
      benchmarkId: "terminal_bench",
      model: "anthropic/claude-opus-5",
      panelConfig: undefined,
      artifactDir: undefined,
      endpointId: undefined,
      imageDetail: undefined,
    });
    expect(config).toMatchObject({
      benchmarkId: "terminal_bench",
      agent: "pi",
    });
  });

  it("defaults terminal_bench to the unified ori reasoning effort", () => {
    const config = buildBenchmarkConfig({
      benchmarkId: "terminal_bench",
      model: "anthropic/claude-opus-5",
      panelConfig: undefined,
      artifactDir: undefined,
      endpointId: undefined,
      imageDetail: undefined,
    });
    expect(config).toMatchObject({
      benchmarkId: "terminal_bench",
      agentReasoningEffort: "medium",
      oriChannel: "stable",
    });
  });

  it("treats an empty run identifier as unset rather than malformed", () => {
    const prev = process.env["BENCH_CHILD_WORKFLOW_ID"];
    process.env["BENCH_CHILD_WORKFLOW_ID"] = "";
    try {
      expect(() =>
        buildBenchmarkConfig({
          benchmarkId: "terminal_bench",
          model: "anthropic/claude-opus-5",
          panelConfig: undefined,
          artifactDir: undefined,
          endpointId: undefined,
          imageDetail: undefined,
        })
      ).not.toThrow();
    } finally {
      if (prev === undefined) {
        delete process.env["BENCH_CHILD_WORKFLOW_ID"];
      } else {
        process.env["BENCH_CHILD_WORKFLOW_ID"] = prev;
      }
    }
  });

  it("rejects the removed legacy thinking field", () => {
    expect(() =>
      buildBenchmarkConfig({
        benchmarkId: "terminal_bench",
        model: "anthropic/claude-opus-5",
        panelConfig: { thinking: "high" },
        artifactDir: undefined,
        endpointId: undefined,
        imageDetail: undefined,
      })
    ).toThrow("Unknown terminal_bench solver-config option(s): thinking");
  });

  it("rejects a misspelled option instead of silently defaulting it", () => {
    expect(() =>
      buildBenchmarkConfig({
        benchmarkId: "terminal_bench",
        model: "anthropic/claude-opus-5",
        panelConfig: { agentReasoningEfort: "max" },
        artifactDir: undefined,
        endpointId: undefined,
        imageDetail: undefined,
      })
    ).toThrow("agentReasoningEfort");
  });

  it("still accepts every documented option and base inference override", () => {
    const config = buildBenchmarkConfig({
      benchmarkId: "terminal_bench",
      model: "anthropic/claude-opus-5",
      panelConfig: {
        agent: "claude",
        agentReasoningEffort: "xhigh",
        oriChannel: "alpha",
        systemPrompt: "terse",
        allowedTools: ["Bash"],
        isolateAgentConfig: true,
        taskSubset: ["fix-git"],
        maxTokens: 1000,
      },
      artifactDir: undefined,
      endpointId: undefined,
      imageDetail: undefined,
    });
    expect(config).toMatchObject({
      agent: "claude",
      agentReasoningEffort: "xhigh",
      oriChannel: "alpha",
      maxTokens: 1000,
    });
  });

  it("rejects an unknown terminal_bench agent", () => {
    expect(() =>
      buildBenchmarkConfig({
        benchmarkId: "terminal_bench",
        model: "anthropic/claude-opus-5",
        panelConfig: { agent: "not-an-agent" },
        artifactDir: undefined,
        endpointId: undefined,
        imageDetail: undefined,
      })
    ).toThrow("Invalid terminal_bench config");
  });

  it("materializes the bm25_grep default for tau3", () => {
    const config = buildBenchmarkConfig({
      benchmarkId: "tau3_bench_banking",
      model: "openai/gpt-4o-mini",
      panelConfig: undefined,
      artifactDir: undefined,
      endpointId: undefined,
      imageDetail: undefined,
    });
    expect(config).toMatchObject({
      benchmarkId: "tau3_bench_banking",
      retrievalConfig: "bm25_grep",
    });
  });
  it("uses server-provided Gemini settings for the TAU user simulator", () => {
    expect(
      tauAirlineUserSimulatorFromEnv({
        TAU_AIRLINE_USER_SIMULATOR_API_KEY: "gemini-key",
      })
    ).toEqual({
      apiKey: "gemini-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.5-flash",
    });
    expect(tauAirlineUserSimulatorFromEnv({})).toBeUndefined();
  });
});
