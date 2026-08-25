import { describe, expect, it } from "bun:test";

import { Either } from "../internal/either";
import { parseSchema } from "../internal/zod";
import { maxActiveRuns, RunRequestSchema, validateRange } from "./index";

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

  it("uses implicit fixed temperature when callers omit it", () => {
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

  it("defaults omitted benchmarks to GPQA and accepts TAU airline", () => {
    const { benchmark: _benchmark, ...withoutBenchmark } = validArgs();
    const defaultBenchmark = parseSchema(RunRequestSchema, withoutBenchmark);
    const tauAirline = parseSchema(RunRequestSchema, {
      ...validArgs(),
      benchmark: "tau_bench_verified_airline",
    });

    expect(Either.isRight(defaultBenchmark)).toBe(true);
    expect(Either.isRight(tauAirline)).toBe(true);
    if (Either.isRight(defaultBenchmark)) {
      expect(defaultBenchmark.right.benchmark).toBe("gpqa_diamond");
    }
  });

  it("accepts optional advanced inference configuration", () => {
    const parsed = parseSchema(RunRequestSchema, {
      ...validArgs(),
      inference: {
        ...validArgs().inference,
        maxTokens: 8192,
        reasoningEffort: "high",
        timeoutMs: 120_000,
        sort: "throughput",
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

  it("rejects unsupported benchmarks and temperature overrides", () => {
    const wrongBenchmark = parseSchema(RunRequestSchema, {
      ...validArgs(),
      benchmark: "mmlu_pro",
    });
    const wrongTemperature = parseSchema(RunRequestSchema, {
      ...validArgs(),
      inference: { ...validArgs().inference, temperature: 0.7 },
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

describe("active run limit", () => {
  it("never allows more than three active runs", () => {
    const original = process.env["BENCH_API_MAX_RUNS"];
    try {
      process.env["BENCH_API_MAX_RUNS"] = "10";
      expect(maxActiveRuns()).toBe(3);
      process.env["BENCH_API_MAX_RUNS"] = "2";
      expect(maxActiveRuns()).toBe(2);
      Reflect.deleteProperty(process.env, "BENCH_API_MAX_RUNS");
      expect(maxActiveRuns()).toBe(3);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(process.env, "BENCH_API_MAX_RUNS");
      } else {
        process.env["BENCH_API_MAX_RUNS"] = original;
      }
    }
  });
});
