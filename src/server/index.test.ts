import { describe, expect, it } from "bun:test";

import { Either } from "../internal/either";
import { parseSchema } from "../internal/zod";
import {
  GpqaRetryCampaignRequestSchema,
  maxActiveRuns,
  resolveRunRequest,
  RunRequestSchema,
  validateRange,
} from "./index";

function validArgs() {
  return {
    benchmark: "gpqa_diamond" as const,
    triggeredByEmail: "user@digitalocean.com",
    inference: {
      baseUrl: "https://inference.example.com/v1",
      apiKey: "secret-value",
      model: "model-1",
      temperature: 0.5 as const,
    },
    execution: {
      epochs: 10,
      concurrency: 8,
      unordered: true,
    },
  };
}

describe("benchmark API request validation", () => {
  it("accepts the complete required payload", () => {
    const parsed = parseSchema(RunRequestSchema, validArgs());
    expect(Either.isRight(parsed)).toBe(true);
    if (Either.isRight(parsed)) {
      expect(parsed.right.inference.reasoningEffort).toBeUndefined();
      expect(parsed.right.execution.maxRetries).toBeUndefined();
    }
  });

  it("accepts omitted inference parameters for benchmark defaults", () => {
    const { temperature: _temperature, ...inference } = validArgs().inference;
    const parsed = parseSchema(RunRequestSchema, {
      ...validArgs(),
      inference,
    });

    expect(Either.isRight(parsed)).toBe(true);
    if (Either.isRight(parsed)) {
      expect(parsed.right.inference.temperature).toBeUndefined();
    }
  });

  it("applies benchmark-specific defaults", () => {
    const {
      inference: { temperature: _temperature, ...inferenceWithoutTemperature },
      execution: _execution,
      ...base
    } = validArgs();
    const gpqa = parseSchema(RunRequestSchema, {
      ...base,
      inference: inferenceWithoutTemperature,
    });
    const tau = parseSchema(RunRequestSchema, {
      ...base,
      benchmark: "tau_bench_verified_airline",
      inference: inferenceWithoutTemperature,
    });
    const deepSwe = parseSchema(RunRequestSchema, {
      ...base,
      benchmark: "deep_swe",
      inference: inferenceWithoutTemperature,
    });
    const sweBench = parseSchema(RunRequestSchema, {
      ...base,
      benchmark: "swe_bench_verified",
      inference: inferenceWithoutTemperature,
    });
    const terminalBench = parseSchema(RunRequestSchema, {
      ...base,
      benchmark: "terminal_bench",
      inference: inferenceWithoutTemperature,
    });
    const sweAtlasQa = parseSchema(RunRequestSchema, {
      ...base,
      benchmark: "swe_atlas_qa",
      judgeModel: "judge/model",
      inference: inferenceWithoutTemperature,
    });
    expect(Either.isRight(gpqa)).toBe(true);
    expect(Either.isRight(tau)).toBe(true);
    expect(Either.isRight(deepSwe)).toBe(true);
    expect(Either.isRight(sweBench)).toBe(true);
    expect(Either.isRight(terminalBench)).toBe(true);
    expect(Either.isRight(sweAtlasQa)).toBe(true);
    if (
      Either.isRight(gpqa) &&
      Either.isRight(tau) &&
      Either.isRight(deepSwe) &&
      Either.isRight(sweBench) &&
      Either.isRight(terminalBench) &&
      Either.isRight(sweAtlasQa)
    ) {
      expect(resolveRunRequest(gpqa.right).args).toMatchObject({
        benchmark: "gpqa_diamond",
        inference: {
          temperature: 1,
          reasoningEffort: "high",
          completionTimeoutMs: 3_600_000,
        },
        execution: { epochs: 3, concurrency: 3, maxRetries: 6 },
      });
      expect(resolveRunRequest(tau.right).args).toMatchObject({
        benchmark: "tau_bench_verified_airline",
        inference: {
          temperature: 0,
          reasoningEffort: "high",
          completionTimeoutMs: 3_600_000,
        },
        execution: { epochs: 3, concurrency: 3, maxRetries: 6 },
      });
      expect(resolveRunRequest(deepSwe.right).args).toMatchObject({
        benchmark: "deep_swe",
        inference: {
          temperature: 0,
          reasoningEffort: "high",
          completionTimeoutMs: 3_600_000,
        },
        execution: { epochs: 1, concurrency: 1, maxRetries: 6 },
      });
      expect(resolveRunRequest(sweBench.right).args).toMatchObject({
        benchmark: "swe_bench_verified",
        inference: { temperature: 0 },
        execution: { epochs: 1, concurrency: 1, maxRetries: 6 },
      });
      expect(resolveRunRequest(terminalBench.right).args).toMatchObject({
        benchmark: "terminal_bench",
        inference: {
          temperature: 0,
          reasoningEffort: "high",
          completionTimeoutMs: 3_600_000,
        },
        execution: { epochs: 1, concurrency: 1, maxRetries: 6 },
      });
      expect(resolveRunRequest(sweAtlasQa.right).args).toMatchObject({
        benchmark: "swe_atlas_qa",
        judgeModel: "judge/model",
        inference: {
          temperature: 0,
          reasoningEffort: "high",
          completionTimeoutMs: 3_600_000,
        },
        execution: { epochs: 1, concurrency: 1, maxRetries: 6 },
      });
    }
  });

  it("preserves explicit overrides of benchmark defaults", () => {
    const parsed = parseSchema(RunRequestSchema, {
      ...validArgs(),
      inference: {
        ...validArgs().inference,
        temperature: 0.7,
        reasoningEffort: "low",
      },
      execution: {
        epochs: 2,
        concurrency: 5,
        maxRetries: 0,
      },
    });

    expect(Either.isRight(parsed)).toBe(true);
    if (Either.isRight(parsed)) {
      expect(resolveRunRequest(parsed.right).args).toMatchObject({
        inference: { temperature: 0.7, reasoningEffort: "low" },
        execution: { epochs: 2, concurrency: 5, maxRetries: 0 },
      });
    }
  });

  it("defaults omitted benchmarks to GPQA and accepts supported benchmarks", () => {
    const { benchmark: _benchmark, ...withoutBenchmark } = validArgs();
    const defaultBenchmark = parseSchema(RunRequestSchema, withoutBenchmark);
    const tauAirline = parseSchema(RunRequestSchema, {
      ...validArgs(),
      benchmark: "tau_bench_verified_airline",
    });
    const deepSwe = parseSchema(RunRequestSchema, {
      ...validArgs(),
      benchmark: "deep_swe",
      execution: { ...validArgs().execution, concurrency: 6 },
    });
    const sweBench = parseSchema(RunRequestSchema, {
      ...validArgs(),
      benchmark: "swe_bench_verified",
      execution: { ...validArgs().execution, concurrency: 6 },
    });
    const terminalBench = parseSchema(RunRequestSchema, {
      ...validArgs(),
      benchmark: "terminal_bench",
      execution: { ...validArgs().execution, concurrency: 6 },
    });
    const sweAtlasQa = parseSchema(RunRequestSchema, {
      ...validArgs(),
      benchmark: "swe_atlas_qa",
      execution: { ...validArgs().execution, concurrency: 6 },
    });
    const sweAtlasTw = parseSchema(RunRequestSchema, {
      ...validArgs(),
      benchmark: "swe_atlas_tw",
      execution: { ...validArgs().execution, concurrency: 6 },
    });
    const sweAtlasRf = parseSchema(RunRequestSchema, {
      ...validArgs(),
      benchmark: "swe_atlas_rf",
      execution: { ...validArgs().execution, concurrency: 6 },
    });

    expect(Either.isRight(defaultBenchmark)).toBe(true);
    expect(Either.isRight(tauAirline)).toBe(true);
    expect(Either.isRight(deepSwe)).toBe(true);
    expect(Either.isRight(sweBench)).toBe(true);
    expect(Either.isRight(terminalBench)).toBe(true);
    expect(Either.isRight(sweAtlasQa)).toBe(true);
    expect(Either.isRight(sweAtlasTw)).toBe(true);
    expect(Either.isRight(sweAtlasRf)).toBe(true);
    if (Either.isRight(defaultBenchmark)) {
      expect(defaultBenchmark.right.benchmark).toBe("gpqa_diamond");
    }
  });

  it("applies judge and sandbox defaults to every SWE Atlas track", () => {
    const { execution: _execution, ...base } = validArgs();
    for (const benchmark of [
      "swe_atlas_qa",
      "swe_atlas_tw",
      "swe_atlas_rf",
    ] as const) {
      const parsed = parseSchema(RunRequestSchema, {
        ...base,
        benchmark,
        judgeModel: "judge/model",
      });
      expect(Either.isRight(parsed)).toBe(true);
      if (Either.isRight(parsed)) {
        expect(resolveRunRequest(parsed.right).args).toMatchObject({
          benchmark,
          judgeModel: "judge/model",
          execution: { epochs: 1, concurrency: 1 },
        });
      }
    }
  });

  it("caps sandbox benchmark concurrency at six workers", () => {
    const allowed = parseSchema(RunRequestSchema, {
      ...validArgs(),
      benchmark: "deep_swe",
      execution: { ...validArgs().execution, concurrency: 6 },
    });
    const gpqa = parseSchema(RunRequestSchema, {
      ...validArgs(),
      execution: { ...validArgs().execution, concurrency: 64 },
    });

    expect(Either.isRight(allowed)).toBe(true);
    for (const benchmark of [
      "deep_swe",
      "swe_bench_verified",
      "terminal_bench",
      "swe_atlas_qa",
      "swe_atlas_tw",
      "swe_atlas_rf",
    ] as const) {
      const rejected = parseSchema(RunRequestSchema, {
        ...validArgs(),
        benchmark,
        execution: { ...validArgs().execution, concurrency: 7 },
      });
      expect(Either.isLeft(rejected)).toBe(true);
    }
    expect(Either.isRight(gpqa)).toBe(true);
  });

  it("accepts optional advanced inference configuration", () => {
    const parsed = parseSchema(RunRequestSchema, {
      ...validArgs(),
      inference: {
        ...validArgs().inference,
        maxTokens: 8192,
        reasoningEffort: "high",
        timeoutMs: 120_000,
        completionTimeoutMs: 1_800_000,
        sort: "throughput",
        providerOnly: ["digitalocean"],
        allowFallbacks: false,
        cloudflareVersion: "v2",
        costQualityTradeoff: 7,
        pinModel: false,
      },
      execution: {
        ...validArgs().execution,
        maxRetries: 6,
      },
    });

    expect(Either.isRight(parsed)).toBe(true);
  });

  it("rejects unsupported benchmarks and out-of-range temperatures", () => {
    const wrongBenchmark = parseSchema(RunRequestSchema, {
      ...validArgs(),
      benchmark: "mmlu_pro",
    });
    const wrongTemperature = parseSchema(RunRequestSchema, {
      ...validArgs(),
      inference: { ...validArgs().inference, temperature: 2.1 },
    });
    expect(Either.isLeft(wrongBenchmark)).toBe(true);
    expect(Either.isLeft(wrongTemperature)).toBe(true);
  });

  it("requires and normalizes a DigitalOcean email address", () => {
    const externalEmail = parseSchema(RunRequestSchema, {
      ...validArgs(),
      triggeredByEmail: "user@example.com",
    });
    const digitalOceanEmail = parseSchema(RunRequestSchema, {
      ...validArgs(),
      triggeredByEmail: "USER@DIGITALOCEAN.COM",
    });

    expect(Either.isLeft(externalEmail)).toBe(true);
    expect(Either.isRight(digitalOceanEmail)).toBe(true);
    if (Either.isRight(digitalOceanEmail)) {
      expect(digitalOceanEmail.right.triggeredByEmail).toBe(
        "user@digitalocean.com"
      );
    }
  });

  it("accepts arbitrary URLs and requires a payload API key", () => {
    const arbitraryUrl = parseSchema(RunRequestSchema, {
      ...validArgs(),
      inference: {
        ...validArgs().inference,
        baseUrl: "https://inference.example/v1",
      },
    });
    const emptyApiKey = parseSchema(RunRequestSchema, {
      ...validArgs(),
      inference: { ...validArgs().inference, apiKey: "" },
    });

    expect(Either.isRight(arbitraryUrl)).toBe(true);
    expect(Either.isLeft(emptyApiKey)).toBe(true);
  });

  it("rejects ambiguous and empty ranges", () => {
    expect(
      validateRange({
        ...validArgs(),
        execution: {
          ...validArgs().execution,
          limit: 10,
          end: 20,
        },
      })
    ).toBe("execution.limit and execution.end are mutually exclusive");
    expect(
      validateRange({
        ...validArgs(),
        execution: {
          ...validArgs().execution,
          start: 20,
          end: 20,
        },
      })
    ).toBe("execution.end must be greater than execution.start");
  });
});

describe("GPQA retry campaign request validation", () => {
  it("accepts independent original and alternate arm configurations", () => {
    const parsed = parseSchema(GpqaRetryCampaignRequestSchema, {
      selectedFailureCounts: [3, 2],
      triggeredByEmail: "USER@DIGITALOCEAN.COM",
      original: {
        apiKey: "original-secret",
        repetitions: 4,
        concurrency: 2,
        inference: {
          baseUrl: "https://inference.do-ai.run/v1",
          model: "source-model",
          temperature: 1,
          reasoningEffort: "high",
        },
      },
      comparison: {
        apiKey: "comparison-secret",
        repetitions: 6,
        concurrency: 3,
        unordered: true,
        maxRetries: 5,
        inference: {
          baseUrl: "https://openrouter.ai/api/v1",
          model: "deepseek/deepseek-v4",
          providerOnly: ["digitalocean"],
          allowFallbacks: false,
          reasoningEffort: "high",
        },
      },
    });

    expect(Either.isRight(parsed)).toBe(true);
    if (Either.isRight(parsed)) {
      expect(parsed.right.triggeredByEmail).toBe("user@digitalocean.com");
      expect(parsed.right.original.repetitions).toBe(4);
      expect(parsed.right.original.inference?.model).toBe("source-model");
      expect(parsed.right.comparison).toMatchObject({
        repetitions: 6,
        inference: {
          providerOnly: ["digitalocean"],
          allowFallbacks: false,
        },
      });
    }
  });

  it("rejects an empty failure-band selection", () => {
    const missingBands = parseSchema(GpqaRetryCampaignRequestSchema, {
      selectedFailureCounts: [],
      triggeredByEmail: "user@digitalocean.com",
      original: { apiKey: "secret", repetitions: 1 },
    });
    expect(Either.isLeft(missingBands)).toBe(true);
  });
});

describe("active run limit", () => {
  it("never allows more than eight active runs", () => {
    const original = process.env["BENCH_API_MAX_RUNS"];
    try {
      process.env["BENCH_API_MAX_RUNS"] = "10";
      expect(maxActiveRuns()).toBe(8);
      process.env["BENCH_API_MAX_RUNS"] = "2";
      expect(maxActiveRuns()).toBe(2);
      Reflect.deleteProperty(process.env, "BENCH_API_MAX_RUNS");
      expect(maxActiveRuns()).toBe(8);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(process.env, "BENCH_API_MAX_RUNS");
      } else {
        process.env["BENCH_API_MAX_RUNS"] = original;
      }
    }
  });
});
