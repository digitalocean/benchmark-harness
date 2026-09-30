import type { HttpClient } from "@effect/platform";
import { gen } from "effect/Effect";
import type { Layer } from "effect/Layer";
import {
  effect as layerEffect,
  fail as layerFail,
  mergeAll as layerMergeAll,
  provide as layerProvide,
  succeed as layerSucceed,
} from "effect/Layer";

import type { Dataset } from "../../harness/dataset";
import { Scorer } from "../../harness/scorer";
import { Solver } from "../../harness/solver";
import {
  makeResponsesModelLayer,
  ResponsesModel,
} from "../../providers/responses-model";
import { SWE_BENCH_VERIFIED_META } from "../benchmark-meta";
import { makeDigitalOceanSandboxLayerFromEnv } from "../harbor/digitalocean-sandbox";
import { makeModalSandboxLayer } from "../harbor/modal-sandbox";
import { SandboxSession } from "../harbor/sandbox";
import type { Benchmark, BenchmarkRunInput } from "../types";
import { makeSweBenchDatasetLayer, SWE_BENCH_DATASET_ID } from "./dataset";
import { sweBenchScorer } from "./scorer";
import { makeSweBenchSolver } from "./solver";

const SWE_BENCH_HARNESS_TEMPERATURE = 0;
const SWE_BENCH_DO_SIZE_ENV = "SWE_BENCH_DO_SANDBOX_SIZE";

export function sweBenchDigitalOceanSandboxEnv(
  env: Readonly<Record<string, string | undefined>>
): Readonly<Record<string, string | undefined>> {
  const size = env[SWE_BENCH_DO_SIZE_ENV]?.trim();
  return size === undefined || size.length === 0
    ? env
    : { ...env, DO_SANDBOX_SIZE: size };
}

function makeSweBenchSandboxLayer(
  modalEnvironment: string
): Layer<SandboxSession, Error> {
  const backend = (
    process.env["BENCH_HARBOR_SANDBOX"] ?? "modal"
  ).toLowerCase();
  switch (backend) {
    case "digitalocean": {
      return makeDigitalOceanSandboxLayerFromEnv(
        sweBenchDigitalOceanSandboxEnv(process.env)
      );
    }
    case "modal": {
      return makeModalSandboxLayer({
        appName: "openrouter-swe-bench-verified",
        environment: modalEnvironment,
      });
    }
    default: {
      return layerFail(
        new Error(
          `Unsupported BENCH_HARBOR_SANDBOX "${backend}"; expected "modal" or "digitalocean"`
        )
      );
    }
  }
}

function makeSweBenchLayer(
  input: BenchmarkRunInput
): Layer<Dataset | Solver | Scorer, Error, HttpClient.HttpClient> {
  const { benchmarkConfig } = input;
  if (benchmarkConfig.benchmarkId !== SWE_BENCH_DATASET_ID) {
    return layerFail(
      new Error(`${SWE_BENCH_DATASET_ID} received mismatched benchmarkConfig`)
    );
  }
  const datasetLayer = makeSweBenchDatasetLayer({
    ...(benchmarkConfig.taskSubset !== undefined && {
      taskSubset: benchmarkConfig.taskSubset,
    }),
    ...(benchmarkConfig.maxAgentTimeoutSec !== undefined && {
      maxAgentTimeoutSec: benchmarkConfig.maxAgentTimeoutSec,
    }),
  });
  const modelLayer =
    input.responsesModelLayer ??
    makeResponsesModelLayer({
      model: benchmarkConfig.model,
      apiKey: input.apiKey,
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      sessionId: input.sessionId,
      ...(input.modelRetry !== undefined && { retry: input.modelRetry }),
      traceHeaders: input.traceHeaders,
    });
  const sandboxLayer = makeSweBenchSandboxLayer(benchmarkConfig.modalEnv);
  const solverLayer = layerEffect(Solver)(
    gen(function* () {
      const model = yield* ResponsesModel;
      const sessionFactory = yield* SandboxSession;
      return Solver.of(
        makeSweBenchSolver(model, sessionFactory, {
          model: benchmarkConfig.model,
          apiKey: input.apiKey,
          stepLimit: benchmarkConfig.stepLimit,
          agent: benchmarkConfig.agent,
          agentCli: {
            model: benchmarkConfig.model,
            apiKey: input.apiKey,
            sessionId: input.sessionId,
            ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
            ...(benchmarkConfig.endpointId !== undefined && {
              endpointId: benchmarkConfig.endpointId,
            }),
            ...(benchmarkConfig.agentPackage !== undefined && {
              agentPackage: benchmarkConfig.agentPackage,
            }),
            oriInstallUrl: benchmarkConfig.oriInstallUrl,
            agentReasoningEffort: benchmarkConfig.agentReasoningEffort,
            oriChannel: benchmarkConfig.oriChannel,
            ...(benchmarkConfig.systemPrompt !== undefined && {
              systemPrompt: benchmarkConfig.systemPrompt,
            }),
            ...(benchmarkConfig.appendSystemPrompt !== undefined && {
              appendSystemPrompt: benchmarkConfig.appendSystemPrompt,
            }),
            ...(benchmarkConfig.allowedTools !== undefined && {
              allowedTools: benchmarkConfig.allowedTools,
            }),
            ...(benchmarkConfig.disallowedTools !== undefined && {
              disallowedTools: benchmarkConfig.disallowedTools,
            }),
            isolateAgentConfig: benchmarkConfig.isolateAgentConfig,
          },
          ...(benchmarkConfig.endpointId !== undefined && {
            endpointId: benchmarkConfig.endpointId,
          }),
          sessionId: input.sessionId,
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
            pinModel: benchmarkConfig.pinModel,
          },
        })
      );
    })
  );
  const scorerLayer = layerSucceed(Scorer, Scorer.of(sweBenchScorer));
  const infraLayer = layerMergeAll(modelLayer, sandboxLayer);
  return layerMergeAll(
    datasetLayer,
    solverLayer.pipe(layerProvide(infraLayer)),
    scorerLayer
  );
}

export const SWE_BENCH_VERIFIED_BENCHMARK: Benchmark = {
  id: SWE_BENCH_VERIFIED_META.id,
  makeDatasetLayer: () => makeSweBenchDatasetLayer(),
  temperature: SWE_BENCH_HARNESS_TEMPERATURE,
  defaultEpochs: SWE_BENCH_VERIFIED_META.defaultEpochs,
  degradeSolverErrors: true,
  makeLayer: makeSweBenchLayer,
};
