import {
  DEFAULT_REWARD_BASIS,
  Tau2TaskSchema,
} from "../benchmarks/tau-bench-airline/types";
import { ScoreValue } from "../harness/core";
import { Either } from "../internal/either";
import { parseSchema, z } from "../internal/zod";
import type { BenchmarkResultRow } from "../results/parquet-schema";

export type TauAirlineReportStatus = "passed" | "failed" | "skipped";

export interface TauAirlineToolCall {
  readonly name: string;
  readonly arguments: unknown;
}

export interface TauAirlineConversationTurn {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly reasoning: string | null;
  readonly toolCalls: readonly TauAirlineToolCall[];
  readonly toolCallId: string | null;
}

export interface TauAirlineExpectedAction {
  readonly requestor: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly info: string | null;
  readonly compareArgs: readonly string[] | null;
}

export interface TauAirlineReportItem {
  readonly sampleId: string;
  readonly taskId: string;
  readonly epoch: number;
  readonly status: TauAirlineReportStatus;
  readonly latencyMs: number | null;
  readonly reward: number | null;
  readonly scenario: string;
  readonly persona: string | null;
  readonly purpose: string | null;
  readonly expectedActions: readonly TauAirlineExpectedAction[];
  readonly expectedCommunications: readonly string[];
  readonly expectedEnvironmentAssertions: readonly unknown[];
  readonly expectedNaturalLanguageAssertions: readonly string[];
  readonly rewardBasis: readonly string[];
  readonly actualToolCalls: readonly TauAirlineToolCall[];
  readonly conversation: readonly TauAirlineConversationTurn[];
  readonly finalAgentAnswer: string | null;
  readonly terminationReason: string;
  readonly stepCount: number | null;
  readonly scorerExplanation: string | null;
  readonly hasReasoning: boolean;
}

export interface TauAirlineReport {
  readonly task: "tau_bench_verified_airline";
  readonly model: string;
  readonly totalGenerationTimeMs: number;
  readonly evaluations: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly items: readonly TauAirlineReportItem[];
}

const PersistedToolCallSchema = z.object({
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const PersistedMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  reasoning: z.string().optional(),
  tool_calls: z.array(PersistedToolCallSchema).optional(),
  tool_call_id: z.string().optional(),
});

const PersistedMessagesSchema = z.array(PersistedMessageSchema);

const ResultMetadataSchema = z.object({
  task: Tau2TaskSchema.optional(),
  terminationReason: z.string().optional(),
  stepCount: z.number().int().nonnegative().optional(),
});

function parsedJson(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function toolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function conversation(row: BenchmarkResultRow): TauAirlineConversationTurn[] {
  const parsed = parseSchema(PersistedMessagesSchema, parsedJson(row.messages));
  if (Either.isLeft(parsed)) {
    return [];
  }
  return parsed.right.flatMap((message) =>
    message.role === "system"
      ? []
      : [
          {
            role: message.role,
            content: message.content,
            reasoning: message.reasoning ?? null,
            toolCalls: (message.tool_calls ?? []).map((toolCall) => ({
              name: toolCall.function.name,
              arguments: toolArguments(toolCall.function.arguments),
            })),
            toolCallId: message.tool_call_id ?? null,
          },
        ]
  );
}

function metadata(row: BenchmarkResultRow) {
  const parsed = parseSchema(ResultMetadataSchema, parsedJson(row.metadata));
  return Either.isRight(parsed) ? parsed.right : undefined;
}

function statusOf(scoreValue: string): TauAirlineReportStatus {
  if (scoreValue === ScoreValue.Correct) {
    return "passed";
  }
  if (scoreValue === ScoreValue.Skipped) {
    return "skipped";
  }
  return "failed";
}

function numericReward(answer: string | null): number | null {
  const reward = Number(answer);
  return answer !== null && Number.isFinite(reward) ? reward : null;
}

function reportItem(row: BenchmarkResultRow): TauAirlineReportItem {
  const resultMetadata = metadata(row);
  const task = resultMetadata?.task;
  const criteria = task?.evaluation_criteria;
  const turns = conversation(row);
  const expectedActions = (criteria?.actions ?? []).map((action) => ({
    requestor: action.requestor,
    name: action.name,
    arguments: action.arguments,
    info: action.info ?? null,
    compareArgs: action.compare_args ?? null,
  }));
  const actualToolCalls = turns.flatMap(({ toolCalls }) => toolCalls);
  const finalAgentAnswer =
    turns
      .toReversed()
      .find(
        (turn) =>
          turn.role === "assistant" &&
          turn.toolCalls.length === 0 &&
          turn.content.trim().length > 0
      )?.content ?? null;
  return {
    sampleId: row.sample_id,
    taskId: task?.id ?? row.sample_id,
    epoch: row.epoch,
    status: statusOf(row.score_value),
    latencyMs: row.sample_generation_time_ms ?? null,
    reward: numericReward(row.answer),
    scenario: row.input ?? "",
    persona: task?.user_scenario.persona ?? null,
    purpose: task?.description?.purpose ?? null,
    expectedActions,
    expectedCommunications: criteria?.communicate_info ?? [],
    expectedEnvironmentAssertions: criteria?.env_assertions ?? [],
    expectedNaturalLanguageAssertions: criteria?.nl_assertions ?? [],
    rewardBasis:
      criteria === null || criteria === undefined
        ? []
        : (criteria.reward_basis ?? DEFAULT_REWARD_BASIS),
    actualToolCalls,
    conversation: turns,
    finalAgentAnswer,
    terminationReason: resultMetadata?.terminationReason ?? "Unknown",
    stepCount: resultMetadata?.stepCount ?? null,
    scorerExplanation: row.explanation,
    hasReasoning: turns.some(
      ({ reasoning }) => reasoning !== null && reasoning.length > 0
    ),
  };
}

export function buildTauAirlineReport(
  rows: readonly BenchmarkResultRow[]
): TauAirlineReport | null {
  const tauRows = rows.filter(
    (row) => row.task === "tau_bench_verified_airline"
  );
  const [first] = tauRows;
  if (first === undefined) {
    return null;
  }
  const items = tauRows
    .map(reportItem)
    .toSorted(
      (a, b) =>
        a.epoch - b.epoch ||
        a.sampleId.localeCompare(b.sampleId, undefined, { numeric: true })
    );
  return {
    task: "tau_bench_verified_airline",
    model: first.model,
    totalGenerationTimeMs: first.generation_time_ms,
    evaluations: items.length,
    passed: items.filter(({ status }) => status === "passed").length,
    failed: items.filter(({ status }) => status === "failed").length,
    skipped: items.filter(({ status }) => status === "skipped").length,
    items,
  };
}
