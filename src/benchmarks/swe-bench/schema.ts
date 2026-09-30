import type { ValueOf } from "../../internal/guards";
import { z } from "../../internal/zod";

export const SWE_BENCH_NETWORK_MODES = ["public", "none"] as const;

export type SweBenchNetworkMode = ValueOf<typeof SWE_BENCH_NETWORK_MODES>;

const NetworkConfigSchema = z.object({
  network_mode: z.enum(SWE_BENCH_NETWORK_MODES).default("none"),
  timeout_sec: z.number().positive(),
});

export const SweBenchTaskTomlSchema = z.object({
  schema_version: z.string().optional(),
  task: z.object({
    name: z.string(),
    description: z.string().default(""),
  }),
  metadata: z.object({
    difficulty: z.string().optional(),
    category: z.string().optional(),
  }),
  agent: NetworkConfigSchema,
  verifier: NetworkConfigSchema,
  environment: z.object({
    build_timeout_sec: z.number().positive().optional(),
    cpus: z.number().int().positive(),
    memory_mb: z.number().int().positive(),
    storage_mb: z.number().int().positive().optional(),
    gpus: z.number().int().nonnegative().default(0),
  }),
});

export type SweBenchTaskToml = z.infer<typeof SweBenchTaskTomlSchema>;

export interface SweBenchTask {
  readonly id: string;
  readonly taskToml: SweBenchTaskToml;
  readonly taskDir: string;
  readonly testDir: string;
  readonly instructionPath: string;
  readonly dockerImage: string;
  readonly imageBuildSteps: readonly string[];
}

export const SWE_BENCH_WORKDIR = "/testbed" as const;

export const SWE_BENCH_KEEP_ALIVE_COMMAND = ["sleep", "infinity"] as const;

export const DEFAULT_STEP_LIMIT = 1000;
