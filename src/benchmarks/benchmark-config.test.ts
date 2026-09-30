import { describe, expect, it } from "bun:test";

import { assertLeft, assertRight } from "../internal/testing";
import { parseSchema } from "../internal/zod";
import {
  BenchmarkRunConfigSchema,
  HostBenchmarkRunConfigSchema,
  isHostBenchmarkConfig,
  isModelBenchmarkConfig,
  isSearchBenchmarkConfig,
  NativeBenchmarkRunConfigSchema,
} from "./benchmark-config";

describe("benchmark config", () => {
  it("keeps native configs precise while parsing them through the native schema", () => {
    const result = parseSchema(NativeBenchmarkRunConfigSchema, {
      benchmarkId: "search_hle",
      model: "openai/gpt-5.4",
    });

    assertRight(result);
    expect(result.right.benchmarkId).toBe("search_hle");
    expect(result.right.lane).toEqual({
      webSearch: "server-tool",
      engine: "auto",
    });
    expect(isSearchBenchmarkConfig(result.right)).toBe(true);
    expect(isModelBenchmarkConfig(result.right)).toBe(true);
  });

  it("does not let malformed native configs fall through to the host variant", () => {
    const result = parseSchema(BenchmarkRunConfigSchema, {
      benchmarkId: "gpqa_diamond",
      model: 42,
    });

    assertLeft(result);
  });

  it("accepts explicit GPQA and TAU temperature overrides", () => {
    const gpqa = parseSchema(BenchmarkRunConfigSchema, {
      benchmarkId: "gpqa_diamond",
      model: "provider/model",
      temperature: 0.7,
    });
    const tau = parseSchema(BenchmarkRunConfigSchema, {
      benchmarkId: "tau_bench_verified_airline",
      model: "provider/model",
      temperature: 0.2,
    });

    assertRight(gpqa);
    assertRight(tau);
    expect(gpqa.right).toMatchObject({ temperature: 0.7 });
    expect(tau.right).toMatchObject({ temperature: 0.2 });
  });

  it("parses host configs with opaque options", () => {
    const result = parseSchema(BenchmarkRunConfigSchema, {
      benchmarkId: "host_benchmark",
      model: "host/model",
      options: {
        subsets: ["all"],
        customFlag: true,
      },
    });

    assertRight(result);
    expect(result.right).toEqual({
      benchmarkId: "host_benchmark",
      model: "host/model",
      options: {
        subsets: ["all"],
        customFlag: true,
      },
    });
    expect(isHostBenchmarkConfig(result.right)).toBe(true);
    expect(isModelBenchmarkConfig(result.right)).toBe(true);
    expect(isSearchBenchmarkConfig(result.right)).toBe(false);
  });

  it("defaults host options to an empty object", () => {
    const result = parseSchema(HostBenchmarkRunConfigSchema, {
      benchmarkId: "host_benchmark",
      model: "host/model",
    });

    assertRight(result);
    expect(result.right.options).toEqual({});
  });

  it("rejects a host config that reuses a native benchmark id", () => {
    const result = parseSchema(HostBenchmarkRunConfigSchema, {
      benchmarkId: "gpqa_diamond",
      model: "host/model",
      options: { subsets: ["all"] },
    });

    assertLeft(result);
  });
});
