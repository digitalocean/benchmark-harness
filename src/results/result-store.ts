import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Tag } from "effect/Context";
import type { Effect } from "effect/Effect";
import { succeed } from "effect/Effect";

import type { BenchmarkRunConfig } from "../benchmarks/benchmark-config";
import { modelFromConfig } from "../benchmarks/benchmark-config";
import type { BenchmarkMetadata } from "../benchmarks/types";
import type { RunResult } from "../harness/run";
import { definedValues } from "../internal/guards";
import { iLog } from "../internal/log";
import { runResultToParquet } from "./parquet";

export interface ResultStoreService {
  readonly write: (opts: {
    readonly result: RunResult;
    readonly benchmark: BenchmarkMetadata;
    readonly benchmarkConfig: BenchmarkRunConfig;
    readonly epochs: number;
    readonly sessionId: string;
  }) => Effect<string | null>;
}

export class ResultStore extends Tag("@openrouter/bench-harness/result-store")<
  ResultStore,
  ResultStoreService
>() {}

function configuredTemperature(
  benchmarkConfig: BenchmarkRunConfig,
  fallback: number
): number {
  return "temperature" in benchmarkConfig &&
    typeof benchmarkConfig.temperature === "number"
    ? benchmarkConfig.temperature
    : fallback;
}

export function makeLocalResultStore(opts: {
  readonly dir: string;
}): ResultStoreService {
  return {
    write: ({ result, benchmark, benchmarkConfig, epochs, sessionId }) => {
      const benchmarkId = benchmarkConfig.benchmarkId;
      const model = modelFromConfig(benchmarkConfig) ?? benchmarkId;
      iLog("Starting benchmark result serialization", {
        benchmark: benchmarkId,
        model,
        sessionId,
        sampleScores: result.sampleScores.length,
        memory: process.memoryUsage(),
      });
      const extraScores = benchmark.runLevelScores?.(result);
      const primaryScore = benchmark.primaryScore?.(result);
      const parquetBuffer = runResultToParquet(
        definedValues({
          result,
          meta: {
            task: benchmarkId,
            model,
            epochs,
            temperature: configuredTemperature(
              benchmarkConfig,
              benchmark.temperature
            ),
            benchmarkConfig,
          },
          extraScores,
          primaryScore,
        })
      );
      const safeModel = model.replaceAll("/", "_");
      const filename = `${benchmarkId}-${safeModel}-${sessionId}.parquet`;
      const filepath = join(opts.dir, filename);
      mkdirSync(opts.dir, { recursive: true });
      writeFileSync(filepath, parquetBuffer);
      iLog("Benchmark Parquet result written", {
        benchmark: benchmarkId,
        model,
        sessionId,
        filepath,
        bytes: parquetBuffer.byteLength,
        memory: process.memoryUsage(),
      });
      return succeed(filepath);
    },
  };
}
