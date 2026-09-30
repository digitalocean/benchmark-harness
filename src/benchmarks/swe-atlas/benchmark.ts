import type { HttpClient } from "@effect/platform";
import { gen } from "effect/Effect";
import type { Layer } from "effect/Layer";
import {
  fail as layerFail,
  effect as layerEffect,
  provide as layerProvide,
  mergeAll as layerMergeAll,
  succeed as layerSucceed,
} from "effect/Layer";

import type { Dataset } from "../../harness/dataset";
import { Scorer } from "../../harness/scorer";
import { Solver } from "../../harness/solver";
import { definedValues } from "../../internal/guards";
import {
  makeResponsesModelLayer,
  ResponsesModel,
} from "../../providers/responses-model";
import {
  SWE_ATLAS_QA_META,
  SWE_ATLAS_RF_META,
  SWE_ATLAS_TW_META,
} from "../benchmark-meta";
import { makeDigitalOceanSandboxLayerFromEnv } from "../harbor/digitalocean-sandbox";
import { makeModalSandboxLayer } from "../harbor/modal-sandbox";
import { SandboxSession } from "../harbor/sandbox";
import type { Benchmark, BenchmarkRunInput } from "../types";
import { makeSweAtlasDatasetLayer, SWE_ATLAS_DATASET_IDS } from "./dataset";
import { JUDGE_BASE_URL } from "./schema";
import type { SweAtlasTrack } from "./schema";
import { sweAtlasScorer } from "./scorer";
import { makeSweAtlasSolver } from "./solver";

const SWE_ATLAS_TEMPERATURE = 0;

export type SweAtlasSandboxBackend = "modal" | "digitalocean";

export function sweAtlasSandboxBackend(value?: string): SweAtlasSandboxBackend {
  const backend = value?.trim().toLowerCase() || "modal";
  if (backend === "modal" || backend === "digitalocean") {
    return backend;
  }
  throw new Error(
    `Unsupported BENCH_HARBOR_SANDBOX=${JSON.stringify(value)}; expected "modal" or "digitalocean"`
  );
}

export function sweAtlasDigitalOceanSandboxEnv(
  env: Readonly<Record<string, string | undefined>> = process.env
): Readonly<Record<string, string | undefined>> {
  const atlasSize = env["SWE_ATLAS_DO_SANDBOX_SIZE"]?.trim();
  if (!atlasSize) {
    return env;
  }
  return { ...env, DO_SANDBOX_SIZE: atlasSize };
}

function makeSweAtlasLayer(
  track: SweAtlasTrack,
  input: BenchmarkRunInput
): Layer<Dataset | Solver | Scorer, Error, HttpClient.HttpClient> {
  const expectedId = SWE_ATLAS_DATASET_IDS[track];
  const { benchmarkConfig } = input;
  if (benchmarkConfig.benchmarkId !== expectedId) {
    return layerFail(
      new Error(`${expectedId} received mismatched benchmarkConfig`)
    );
  }
  const datasetLayer = makeSweAtlasDatasetLayer(
    definedValues({
      track,
      taskSubset: benchmarkConfig.taskSubset,
      maxAgentTimeoutSec: benchmarkConfig.maxAgentTimeoutSec,
    })
  );
  const modelLayer =
    input.responsesModelLayer ??
    makeResponsesModelLayer(
      definedValues({
        model: benchmarkConfig.model,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        sessionId: input.sessionId,
        retry: input.modelRetry,
        traceHeaders: input.traceHeaders,
      })
    );
  let sandboxBackend: SweAtlasSandboxBackend;
  try {
    sandboxBackend = sweAtlasSandboxBackend(
      process.env["BENCH_HARBOR_SANDBOX"]
    );
  } catch (error) {
    return layerFail(error instanceof Error ? error : new Error(String(error)));
  }
  const sandboxLayer: Layer<SandboxSession, Error> =
    sandboxBackend === "digitalocean"
      ? makeDigitalOceanSandboxLayerFromEnv(
          sweAtlasDigitalOceanSandboxEnv(process.env)
        )
      : makeModalSandboxLayer({
          appName: "openrouter-swe-atlas",
          environment: benchmarkConfig.modalEnv,
        });
  const solverLayer = layerEffect(Solver)(
    gen(function* () {
      const model = yield* ResponsesModel;
      const sessionFactory = yield* SandboxSession;
      return Solver.of(
        makeSweAtlasSolver(
          model,
          sessionFactory,
          definedValues({
            track,
            model: benchmarkConfig.model,
            apiKey: input.apiKey,
            judgeModel:
              process.env["SWE_ATLAS_JUDGE_MODEL"] ??
              benchmarkConfig.judgeModel,
            judgeApiKey: process.env["SWE_ATLAS_JUDGE_API_KEY"] ?? input.apiKey,
            judgeBaseUrl:
              process.env["SWE_ATLAS_JUDGE_BASE_URL"] ?? JUDGE_BASE_URL,
            stepLimit: benchmarkConfig.stepLimit,
            agent: benchmarkConfig.agent,
            agentCli: definedValues({
              model: benchmarkConfig.model,
              apiKey: input.apiKey,
              baseUrl: input.baseUrl,
              sessionId: input.sessionId,
              endpointId: benchmarkConfig.endpointId,
              agentPackage: benchmarkConfig.agentPackage,
              oriInstallUrl: benchmarkConfig.oriInstallUrl,
              agentReasoningEffort: benchmarkConfig.agentReasoningEffort,
              oriChannel: benchmarkConfig.oriChannel,
              systemPrompt: benchmarkConfig.systemPrompt,
              appendSystemPrompt: benchmarkConfig.appendSystemPrompt,
              allowedTools: benchmarkConfig.allowedTools,
              disallowedTools: benchmarkConfig.disallowedTools,
              isolateAgentConfig: benchmarkConfig.isolateAgentConfig,
            }),
            endpointId: benchmarkConfig.endpointId,
            inference: {
              temperature: benchmarkConfig.temperature,
              maxTokens: benchmarkConfig.maxTokens,
              reasoningEffort: benchmarkConfig.reasoningEffort,
              timeoutMs: benchmarkConfig.timeoutMs,
              completionTimeoutMs: benchmarkConfig.completionTimeoutMs,
              sort: benchmarkConfig.sort,
              providerOnly: benchmarkConfig.providerOnly,
              providerIgnore: benchmarkConfig.providerIgnore,
              allowFallbacks: benchmarkConfig.allowFallbacks,
              cloudflareVersion: benchmarkConfig.cloudflareVersion,
              costTier: benchmarkConfig.costTier,
              costQualityTradeoff: benchmarkConfig.costQualityTradeoff,
            },
          })
        )
      );
    })
  );
  const scorerLayer = layerSucceed(Scorer, Scorer.of(sweAtlasScorer));
  const infraLayer = layerMergeAll(modelLayer, sandboxLayer);
  return layerMergeAll(
    datasetLayer,
    solverLayer.pipe(layerProvide(infraLayer)),
    scorerLayer
  );
}

export const SWE_ATLAS_QA_BENCHMARK: Benchmark = {
  id: SWE_ATLAS_QA_META.id,
  makeDatasetLayer: () => makeSweAtlasDatasetLayer({ track: "qa" }),
  temperature: SWE_ATLAS_TEMPERATURE,
  defaultEpochs: SWE_ATLAS_QA_META.defaultEpochs,
  degradeSolverErrors: true,
  makeLayer: (input) => makeSweAtlasLayer("qa", input),
};

export const SWE_ATLAS_TW_BENCHMARK: Benchmark = {
  id: SWE_ATLAS_TW_META.id,
  makeDatasetLayer: () => makeSweAtlasDatasetLayer({ track: "tw" }),
  temperature: SWE_ATLAS_TEMPERATURE,
  defaultEpochs: SWE_ATLAS_TW_META.defaultEpochs,
  degradeSolverErrors: true,
  makeLayer: (input) => makeSweAtlasLayer("tw", input),
};

export const SWE_ATLAS_RF_BENCHMARK: Benchmark = {
  id: SWE_ATLAS_RF_META.id,
  makeDatasetLayer: () => makeSweAtlasDatasetLayer({ track: "rf" }),
  temperature: SWE_ATLAS_TEMPERATURE,
  defaultEpochs: SWE_ATLAS_RF_META.defaultEpochs,
  degradeSolverErrors: true,
  makeLayer: (input) => makeSweAtlasLayer("rf", input),
};
