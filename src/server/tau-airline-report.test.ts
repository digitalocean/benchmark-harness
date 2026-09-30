import { describe, expect, it } from "bun:test";

import type { BenchmarkResultRow } from "../results/parquet-schema";
import { buildTauAirlineReport } from "./tau-airline-report";

function row(
  scoreValue: "C" | "I" | "S",
  answer: string | null
): BenchmarkResultRow {
  return {
    format_version: 1,
    task: "tau_bench_verified_airline",
    model: "provider/model",
    epochs: 1,
    temperature: 0,
    benchmark_config: null,
    created_at: "2026-08-26T10:00:00.000Z",
    accuracy: 1,
    total_questions: 1,
    correct_answers: 1,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    reasoning_tokens: 20,
    total_cost: 0.01,
    generation_time_ms: 1000,
    epoch_total_questions: null,
    epoch_correct_answers: null,
    extra_scores: null,
    primary_score: null,
    sample_id: `tau_bench_verified_airline-task-${scoreValue}`,
    epoch: 0,
    sample_generation_time_ms: 1000,
    input: "Domain: airline\nTask instructions:\n\tCancel my reservation",
    target: "",
    score_value: scoreValue,
    answer,
    explanation: "db_match=true, communicate_met=true, termination=USER_STOP",
    scorer_trajectory: null,
    response_items: null,
    request_body: null,
    generation_ids: null,
    messages: JSON.stringify([
      { role: "system", content: "Airline policy" },
      { role: "assistant", content: "How can I help?" },
      { role: "user", content: "Please cancel reservation ABC123." },
      {
        role: "assistant",
        content: "",
        reasoning: "The user supplied the reservation ID.",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "cancel_reservation",
              arguments: '{"reservation_id":"ABC123"}',
            },
          },
        ],
      },
      {
        role: "tool",
        content: "Reservation ABC123 cancelled",
        tool_call_id: "call-1",
      },
      {
        role: "assistant",
        content: "Your reservation has been cancelled.",
      },
      { role: "user", content: "###STOP###" },
    ]),
    metadata: JSON.stringify({
      task: {
        id: "task-C",
        description: { purpose: "Cancel an existing reservation" },
        user_scenario: {
          persona: "Frequent flyer",
          instructions: {
            domain: "airline",
            reason_for_call: "cancel a flight",
            task_instructions: "Cancel reservation ABC123",
          },
        },
        evaluation_criteria: {
          actions: [
            {
              action_id: "action-1",
              requestor: "assistant",
              name: "cancel_reservation",
              arguments: { reservation_id: "ABC123" },
              compare_args: ["reservation_id"],
            },
          ],
          communicate_info: ["reservation has been cancelled"],
          env_assertions: [],
          nl_assertions: ["The agent confirms cancellation"],
          reward_basis: ["DB", "ACTION", "COMMUNICATE"],
        },
      },
      terminationReason: "USER_STOP",
      stepCount: 6,
      agentData: { omitted: "large state ignored by report" },
    }),
  };
}

describe("buildTauAirlineReport", () => {
  it("extracts scenario, criteria, tool calls, conversation, and reasoning", () => {
    const report = buildTauAirlineReport([
      row("C", "1"),
      row("I", "0"),
      row("S", null),
    ]);

    expect(report).toMatchObject({
      task: "tau_bench_verified_airline",
      model: "provider/model",
      totalGenerationTimeMs: 1000,
      evaluations: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
    });
    expect(report?.items[0]).toMatchObject({
      taskId: "task-C",
      status: "passed",
      latencyMs: 1000,
      reward: 1,
      persona: "Frequent flyer",
      purpose: "Cancel an existing reservation",
      terminationReason: "USER_STOP",
      stepCount: 6,
      finalAgentAnswer: "Your reservation has been cancelled.",
      rewardBasis: ["DB", "ACTION", "COMMUNICATE"],
      expectedCommunications: ["reservation has been cancelled"],
      expectedNaturalLanguageAssertions: ["The agent confirms cancellation"],
      expectedActions: [
        {
          requestor: "assistant",
          name: "cancel_reservation",
          arguments: { reservation_id: "ABC123" },
          info: null,
          compareArgs: ["reservation_id"],
        },
      ],
      actualToolCalls: [
        {
          name: "cancel_reservation",
          arguments: { reservation_id: "ABC123" },
        },
      ],
      hasReasoning: true,
    });
    expect(report?.items[0]?.conversation).toHaveLength(6);
    expect(report?.items[0]?.conversation[2]?.reasoning).toBe(
      "The user supplied the reservation ID."
    );
  });

  it("returns null when no TAU Airline rows are present", () => {
    expect(
      buildTauAirlineReport([{ ...row("C", "1"), task: "gpqa_diamond" }])
    ).toBeNull();
    expect(buildTauAirlineReport([])).toBeNull();
  });
});
