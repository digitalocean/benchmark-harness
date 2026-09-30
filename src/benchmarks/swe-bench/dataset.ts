import { readFileSync } from "node:fs";

import type { Effect } from "effect/Effect";
import { map, tryPromise } from "effect/Effect";
import type { Layer } from "effect/Layer";
import { succeed as layerSucceed } from "effect/Layer";
import {
  flatMap as flatMapStream,
  fromEffect,
  fromIterable,
} from "effect/Stream";

import type { Sample } from "../../harness/core";
import { DatasetError } from "../../harness/core";
import type { DatasetStreamOptions } from "../../harness/dataset";
import { Dataset } from "../../harness/dataset";
import type { SweBenchTask } from "./schema";
import { loadSweBenchTasks } from "./tasks-source";

export const SWE_BENCH_DATASET_ID = "swe_bench_verified" as const;

const DEFAULT_CPUS = 1;
const DEFAULT_MEMORY_MB = 4096;
const DEFAULT_STORAGE_MB = 10_240;

export interface SweBenchSampleMeta {
  readonly taskId: string;
  readonly taskDir: string;
  readonly dockerImage: string;
  readonly maxAgentTimeoutSec: number;
  readonly maxTestTimeoutSec: number;
  readonly cpus: number;
  readonly memoryMb: number;
  readonly storageMb: number;
  readonly allowInternet: boolean;
  readonly category: string;
  readonly difficulty: string;
  reward?: number;
  verifierOutput?: string;
  verifierReport?: string;
  modelPatch?: string;
}

export function taskToSample(
  task: SweBenchTask,
  maxAgentTimeoutSecOverride?: number
): Sample {
  return {
    id: `${SWE_BENCH_DATASET_ID}-${task.id}`,
    input: readFileSync(task.instructionPath, "utf8"),
    target: { text: task.id },
    metadata: {
      taskId: task.id,
      taskDir: task.taskDir,
      dockerImage: task.dockerImage,
      maxAgentTimeoutSec:
        maxAgentTimeoutSecOverride ?? task.taskToml.agent.timeout_sec,
      maxTestTimeoutSec: task.taskToml.verifier.timeout_sec,
      cpus: task.taskToml.environment.cpus,
      memoryMb: task.taskToml.environment.memory_mb,
      storageMb: task.taskToml.environment.storage_mb ?? DEFAULT_STORAGE_MB,
      allowInternet:
        task.taskToml.agent.network_mode === "public" ||
        task.taskToml.verifier.network_mode === "public",
      category: task.taskToml.metadata.category ?? "unknown",
      difficulty: task.taskToml.metadata.difficulty ?? "unknown",
    },
  };
}

export function readSweBenchMeta(
  metadata?: Readonly<Record<string, unknown>>
): SweBenchSampleMeta | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  const taskId = metadata["taskId"];
  const taskDir = metadata["taskDir"];
  const dockerImage = metadata["dockerImage"];
  const maxAgentTimeoutSec = metadata["maxAgentTimeoutSec"];
  const maxTestTimeoutSec = metadata["maxTestTimeoutSec"];
  if (
    typeof taskId !== "string" ||
    typeof taskDir !== "string" ||
    typeof dockerImage !== "string" ||
    typeof maxAgentTimeoutSec !== "number" ||
    typeof maxTestTimeoutSec !== "number"
  ) {
    return undefined;
  }
  const cpus = metadata["cpus"];
  const memoryMb = metadata["memoryMb"];
  const storageMb = metadata["storageMb"];
  const allowInternet = metadata["allowInternet"];
  const category = metadata["category"];
  const difficulty = metadata["difficulty"];
  const reward = metadata["reward"];
  const verifierOutput = metadata["verifierOutput"];
  const verifierReport = metadata["verifierReport"];
  const modelPatch = metadata["modelPatch"];
  return {
    taskId,
    taskDir,
    dockerImage,
    maxAgentTimeoutSec,
    maxTestTimeoutSec,
    cpus: typeof cpus === "number" ? cpus : DEFAULT_CPUS,
    memoryMb: typeof memoryMb === "number" ? memoryMb : DEFAULT_MEMORY_MB,
    storageMb: typeof storageMb === "number" ? storageMb : DEFAULT_STORAGE_MB,
    allowInternet: typeof allowInternet === "boolean" ? allowInternet : true,
    category: typeof category === "string" ? category : "unknown",
    difficulty: typeof difficulty === "string" ? difficulty : "unknown",
    ...(typeof reward === "number" && { reward }),
    ...(typeof verifierOutput === "string" && { verifierOutput }),
    ...(typeof verifierReport === "string" && { verifierReport }),
    ...(typeof modelPatch === "string" && { modelPatch }),
  };
}

export interface SweBenchDatasetConfig {
  readonly taskSubset?: readonly string[];
  readonly maxAgentTimeoutSec?: number;
}

export function makeSweBenchDatasetLayer(
  config?: SweBenchDatasetConfig
): Layer<Dataset> {
  const load = tryPromise({
    try: () => loadSweBenchTasks(),
    catch: (error) =>
      new DatasetError({
        message: `Failed to load SWE-bench Verified tasks: ${String(error)}`,
      }),
  }).pipe(
    map((tasks) => {
      const subset = config?.taskSubset;
      if (subset === undefined || subset.length === 0) {
        return tasks;
      }
      const selected = new Set(subset);
      return tasks.filter((task) => selected.has(task.id));
    })
  );
  const size: Effect<number, DatasetError> = load.pipe(
    map((tasks) => tasks.length)
  );
  const stream = (options?: DatasetStreamOptions) =>
    fromIterableEffect(load, options, config?.maxAgentTimeoutSec);
  return layerSucceed(Dataset, Dataset.of({ size, stream }));
}

function fromIterableEffect(
  load: Effect<readonly SweBenchTask[], DatasetError>,
  options?: DatasetStreamOptions,
  maxAgentTimeoutSec?: number
) {
  return fromEffect(load).pipe(
    flatMapStream((tasks) => {
      const start = options?.start ?? 0;
      const end = Math.min(options?.end ?? tasks.length, tasks.length);
      return fromIterable(
        tasks
          .slice(start, end)
          .map((task) => taskToSample(task, maxAgentTimeoutSec))
      );
    })
  );
}
