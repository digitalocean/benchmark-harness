import { isCause, isInterrupted } from "effect/Cause";
import type { Effect } from "effect/Effect";
import {
  all,
  catchAll,
  catchTag,
  gen,
  logWarning,
  orElseSucceed,
  tryPromise,
  void as effectVoid,
} from "effect/Effect";

import type { ModelUsage } from "../../harness/core";
import { MessageRole, SolverError } from "../../harness/core";
import { CheckpointStore, ProgressReporter } from "../../harness/progress";
import type { SolverService } from "../../harness/solver";
import { unknownErrorToString } from "../../internal/errors";
import { definedValues } from "../../internal/guards";
import type {
  ResponsesGenerateConfig,
  ResponsesModelService,
} from "../../providers/responses-model";
import { responsesMessage } from "../../providers/responses-model";
import { getOriHarness } from "../agent-cli/harness";
import type { AgentCliOpts } from "../agent-cli/runner";
import {
  agentCliMetadata,
  agentImageBuildSteps,
  runAgentCli,
} from "../agent-cli/runner";
import type { HarborAgent } from "../agent-cli/schema";
import { isOriAgent } from "../agent-cli/schema";
import type { InferenceOverride } from "../benchmark-config";
import { AGENT_ENV, runAgentLoop } from "../harbor/agent-loop";
import { BASH_RESPONSES_TOOL_DEFINITION } from "../harbor/prompts";
import { parseReward } from "../harbor/reward";
import type {
  SandboxSessionFactory,
  SandboxSessionInstance,
} from "../harbor/sandbox";
import { REMOTE_TEST_DIR, REMOTE_VERIFIER_SCRIPT } from "../harbor/sandbox";
import { readSweBenchMeta } from "./dataset";
import {
  buildAgentCliAppendSystemPrompt,
  buildMiniSwePrompt,
  MINI_SWE_SYSTEM_PROMPT,
} from "./prompts";
import { SWE_BENCH_KEEP_ALIVE_COMMAND, SWE_BENCH_WORKDIR } from "./schema";
import { loadSweBenchTask } from "./tasks-source";

const SWE_BENCH_TEMPERATURE = 1;
const SWE_BENCH_REASONING_EFFORT = "high" as const;
const PER_COMMAND_TIMEOUT_SEC = 1800;
const SANDBOX_TIMEOUT_MARGIN_SEC = 300;

export const REMOTE_AGENT_INSTRUCTION = "/instruction.md" as const;
export const REMOTE_REWARD_PATH = "/logs/verifier/reward.txt" as const;
export const REMOTE_REPORT_PATH = "/logs/verifier/report.json" as const;

export interface SweBenchSolverOpts {
  readonly model: string;
  readonly apiKey: string;
  readonly endpointId?: string;
  readonly stepLimit: number;
  readonly inference?: InferenceOverride;
  readonly sessionId?: string;
  readonly agent?: HarborAgent;
  readonly agentCli?: AgentCliOpts;
}

export function makeSweBenchSolver(
  model: ResponsesModelService,
  sessionFactory: SandboxSessionFactory,
  opts: SweBenchSolverOpts
): SolverService {
  return (state) =>
    gen(function* () {
      const meta = readSweBenchMeta(state.sample.metadata);
      if (meta === undefined) {
        return yield* new SolverError({
          message: `SWE-bench solver received a sample without metadata (id=${state.sample.id})`,
        });
      }
      const task = yield* tryPromise({
        try: () => loadSweBenchTask(meta.taskDir),
        catch: (error) =>
          new SolverError({
            message: `Failed to load SWE-bench task ${meta.taskId}: ${String(error)}`,
          }),
      });
      const agent = opts.agent ?? "mini_swe";
      const cliHarness = isOriAgent(agent) ? getOriHarness(agent) : undefined;
      const baseCliOpts: AgentCliOpts = opts.agentCli ?? {
        model: opts.model,
        apiKey: opts.apiKey,
        agentReasoningEffort: opts.inference?.reasoningEffort ?? "high",
        ...(opts.endpointId !== undefined && { endpointId: opts.endpointId }),
        ...(opts.sessionId !== undefined && { sessionId: opts.sessionId }),
      };
      const requiredCliPrompt = buildAgentCliAppendSystemPrompt();
      const cliOpts: AgentCliOpts = {
        ...baseCliOpts,
        appendSystemPrompt:
          baseCliOpts.appendSystemPrompt === undefined ||
          baseCliOpts.appendSystemPrompt.length === 0
            ? requiredCliPrompt
            : `${requiredCliPrompt}\n\n${baseCliOpts.appendSystemPrompt}`,
      };
      const reporter = yield* ProgressReporter;
      const checkpointStore = yield* CheckpointStore;
      const epoch = state.epoch;
      const checkpointKey =
        opts.sessionId !== undefined && epoch !== undefined
          ? `${opts.sessionId}/${state.sample.id}/${epoch}`
          : undefined;
      const checkpoint =
        checkpointKey !== undefined
          ? yield* tryPromise({
              try: () => checkpointStore.read(checkpointKey),
              catch: () => null,
            }).pipe(orElseSucceed(() => null))
          : null;
      const createSession = () =>
        sessionFactory.create({
          imageTag: task.dockerImage,
          imageBuildSteps: [
            ...task.imageBuildSteps,
            ...(cliHarness === undefined
              ? []
              : agentImageBuildSteps(cliHarness, cliOpts)),
          ],
          timeoutSec:
            meta.maxAgentTimeoutSec +
            meta.maxTestTimeoutSec +
            SANDBOX_TIMEOUT_MARGIN_SEC,
          cpus: meta.cpus,
          memoryMb: meta.memoryMb,
          allowInternet: meta.allowInternet || cliHarness !== undefined,
          workdir: SWE_BENCH_WORKDIR,
          keepAliveCommand: SWE_BENCH_KEEP_ALIVE_COMMAND,
          uploads:
            cliHarness === undefined
              ? []
              : [
                  {
                    localPath: task.instructionPath,
                    remotePath: REMOTE_AGENT_INSTRUCTION,
                    kind: "file",
                  },
                ],
        });
      let attachSucceeded = true;
      const session =
        checkpoint !== null && cliHarness === undefined
          ? yield* sessionFactory.attach(checkpoint.sandboxId).pipe(
              catchAll(() => {
                attachSucceeded = false;
                return createSession();
              })
            )
          : yield* createSession();
      const resumeFrom =
        checkpoint !== null && attachSucceeded
          ? {
              input: checkpoint.input,
              startStep: checkpoint.step + 1,
              ...(checkpoint.usage !== undefined && {
                usage: checkpoint.usage,
              }),
              ...(checkpoint.generationTimeMs !== undefined && {
                generationTimeMs: checkpoint.generationTimeMs,
              }),
              ...(checkpoint.toolCallIndex !== undefined && {
                toolCallIndex: checkpoint.toolCallIndex,
              }),
            }
          : undefined;
      const genConfig: ResponsesGenerateConfig = {
        temperature: SWE_BENCH_TEMPERATURE,
        reasoningEffort: SWE_BENCH_REASONING_EFFORT,
        tools: [BASH_RESPONSES_TOOL_DEFINITION],
        instructions: MINI_SWE_SYSTEM_PROMPT,
        ...definedValues(opts.inference ?? {}),
        ...(opts.endpointId !== undefined && { endpointId: opts.endpointId }),
      };
      return yield* gen(function* () {
        if (cliHarness !== undefined) {
          const cliRun = yield* runAgentCli({
            session,
            harness: cliHarness,
            opts: cliOpts,
            instructionPath: REMOTE_AGENT_INSTRUCTION,
            timeoutMs: meta.maxAgentTimeoutSec * 1000 + 30_000,
          });
          const modelPatch = yield* captureModelPatch(session);
          yield* session.uploadDir(task.testDir, REMOTE_TEST_DIR);
          const verifier = yield* runVerifier(session, meta.maxTestTimeoutSec);
          const completion = cliRun.finalText ?? cliRun.rawStream;
          return {
            sample: {
              ...state.sample,
              metadata: {
                ...state.sample.metadata,
                reward: verifier.reward,
                verifierOutput: cliRun.failureDetail
                  ? `${cliRun.failureDetail}\n\n${verifier.output}`
                  : verifier.output,
                verifierReport: verifier.report,
                modelPatch,
                ...agentCliMetadata(cliHarness.id, cliRun),
              },
            },
            messages: [
              { role: MessageRole.User, content: state.sample.input },
              ...cliRun.assistantMessages,
            ],
            responseItems: cliRun.responseItems,
            output: {
              completion,
              message: { role: MessageRole.Assistant, content: completion },
              usage: cliRun.usage ?? ZERO_AGENT_USAGE,
              generationTimeMs: cliRun.generationTimeMs ?? 0,
            },
            completed: true,
          };
        }
        const loop = yield* runAgentLoop({
          model,
          session,
          initialInput: [
            responsesMessage("user", buildMiniSwePrompt(state.sample.input)),
          ],
          genConfig,
          stepLimit: opts.stepLimit,
          perCommandTimeoutMs: PER_COMMAND_TIMEOUT_SEC * 1000 + 30_000,
          ...(epoch !== undefined && {
            onStep: (event) =>
              reporter.onAgentStep(event, state.sample.id, epoch),
          }),
          ...(resumeFrom !== undefined && { resumeFrom }),
          ...(checkpointKey !== undefined && {
            onCheckpoint: ({
              input,
              step,
              usage,
              generationTimeMs,
              toolCallIndex,
            }) =>
              tryPromise({
                try: () =>
                  checkpointStore.write(checkpointKey, {
                    sandboxId: session.sandboxId,
                    input,
                    step,
                    usage,
                    generationTimeMs,
                    toolCallIndex,
                  }),
                catch: (error) =>
                  new SolverError({ message: unknownErrorToString(error) }),
              }).pipe(
                catchTag("SolverError", (error) =>
                  logWarning("checkpoint-write-failed", {
                    checkpoint_key: checkpointKey,
                    error: error.message,
                  })
                )
              ),
          }),
        });
        const modelPatch = yield* captureModelPatch(session);
        yield* session.uploadDir(task.testDir, REMOTE_TEST_DIR);
        const verifier = yield* runVerifier(session, meta.maxTestTimeoutSec);
        if (checkpointKey !== undefined) {
          yield* tryPromise({
            try: () => checkpointStore.remove(checkpointKey),
            catch: () => undefined,
          }).pipe(catchAll(() => effectVoid));
        }
        return {
          sample: {
            ...state.sample,
            metadata: {
              ...state.sample.metadata,
              reward: verifier.reward,
              verifierOutput: verifier.output,
              verifierReport: verifier.report,
              modelPatch,
            },
          },
          messages: loop.messages,
          responseItems: loop.input,
          output: {
            completion: loop.finalText,
            message: {
              role: MessageRole.Assistant,
              content: loop.finalText,
            },
            usage: loop.usage,
            generationTimeMs: loop.generationTimeMs,
          },
          completed: true,
        };
      }).pipe(
        ensureDestroy(session, {
          skipOnInterrupt: cliHarness === undefined,
        })
      );
    });
}

function captureModelPatch(
  session: SandboxSessionInstance
): Effect<string, SolverError, never> {
  return gen(function* () {
    const result = yield* session.exec(
      [
        "bash",
        "-lc",
        `cd ${SWE_BENCH_WORKDIR} && git add -A && git diff --cached --binary HEAD`,
      ],
      AGENT_ENV,
      120_000
    );
    if (result.exitCode !== 0) {
      return yield* new SolverError({
        message: `Failed to capture candidate patch (exit ${result.exitCode}): ${`${result.stdout}\n${result.stderr}`.trim()}`,
      });
    }
    return result.stdout;
  });
}

function runVerifier(
  session: SandboxSessionInstance,
  maxTestTimeoutSec: number
): Effect<
  { readonly reward: number; readonly output: string; readonly report: string },
  SolverError,
  never
> {
  return gen(function* () {
    const run = yield* session.exec(
      [
        "bash",
        "-lc",
        `mkdir -p /logs/verifier && bash ${REMOTE_VERIFIER_SCRIPT}`,
      ],
      AGENT_ENV,
      Math.round(maxTestTimeoutSec * 1000) + 30_000
    );
    const [rewardRead, reportRead] = yield* all([
      session.exec(
        ["bash", "-lc", `cat ${REMOTE_REWARD_PATH} 2>/dev/null || true`],
        {},
        10_000
      ),
      session.exec(
        ["bash", "-lc", `cat ${REMOTE_REPORT_PATH} 2>/dev/null || true`],
        {},
        10_000
      ),
    ]);
    return {
      reward: parseReward(rewardRead.stdout),
      output: `${run.stdout}\n${run.stderr}`.trim(),
      report: reportRead.stdout.trim(),
    };
  });
}

function ensureDestroy(
  session: SandboxSessionInstance,
  opts?: { readonly skipOnInterrupt: boolean }
) {
  return <A, E>(
    effect: Effect<A, E, never>
  ): Effect<A, E | SolverError, never> =>
    gen(function* () {
      let shouldDestroy = true;
      try {
        return yield* effect;
      } catch (cause) {
        shouldDestroy = !(
          (opts?.skipOnInterrupt ?? false) &&
          isCause(cause) &&
          isInterrupted(cause)
        );
        throw cause;
      } finally {
        if (shouldDestroy) {
          yield* session.destroy();
        }
      }
    });
}

const ZERO_AGENT_USAGE: ModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
  totalCost: 0,
};
