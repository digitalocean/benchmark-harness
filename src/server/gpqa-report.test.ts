import { describe, expect, it } from "bun:test";

import type { BenchmarkResultRow } from "../results/parquet-schema";
import { buildGpqaReport } from "./gpqa-report";

const INPUT = `Answer the following multiple choice question. The last line of your response should be of the following format: 'Answer: $LETTER' (without quotes) where LETTER is one of ABCD.

Which option is correct?

A) First choice
B) Second choice
C) Third choice
D) Fourth choice`;

function row(
  sampleId: string,
  epoch: number,
  scoreValue: "C" | "I" | "S",
  messages: string | null
): BenchmarkResultRow {
  let answer: string | null = null;
  if (scoreValue === "C") {
    answer = "B";
  } else if (scoreValue === "I") {
    answer = "A";
  }
  return {
    format_version: 1,
    task: "gpqa_diamond",
    model: "provider/model",
    epochs: 2,
    temperature: 0.5,
    benchmark_config: null,
    created_at: "2026-08-26T10:00:00.000Z",
    accuracy: 0.5,
    total_questions: 2,
    correct_answers: 1,
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
    reasoning_tokens: 3,
    total_cost: 0.01,
    generation_time_ms: 100,
    epoch_total_questions: null,
    epoch_correct_answers: null,
    extra_scores: null,
    primary_score: null,
    sample_id: sampleId,
    epoch,
    sample_generation_time_ms: 100,
    input: INPUT,
    target: "B",
    score_value: scoreValue,
    answer,
    explanation:
      scoreValue === "S"
        ? "Model error (skipped)"
        : `Extracted answer for ${sampleId}`,
    scorer_trajectory: null,
    response_items: null,
    request_body: null,
    generation_ids: null,
    messages,
    metadata: JSON.stringify({ subdomain: "Physics" }),
  };
}

describe("buildGpqaReport", () => {
  it("extracts question, choices, model response, target, and reasoning", () => {
    const noAnswer = {
      ...row("gpqa_diamond-3", 0, "I", null),
      answer: null,
      explanation: "No answer found",
    };
    const report = buildGpqaReport([
      row(
        "gpqa_diamond-1",
        0,
        "C",
        JSON.stringify([
          { role: "user", content: INPUT },
          {
            role: "assistant",
            content: "The second option follows from the premise.\nAnswer: B",
            reasoning: "The premise rules out the other three choices.",
          },
        ])
      ),
      row("gpqa_diamond-2", 0, "I", null),
      noAnswer,
      row("gpqa_diamond-4", 1, "S", "{invalid"),
    ]);

    expect(report).toMatchObject({
      task: "gpqa_diamond",
      model: "provider/model",
      totalGenerationTimeMs: 100,
      evaluations: 4,
      correct: 1,
      incorrect: 2,
      wrong: 1,
      noAnswer: 1,
      skipped: 1,
    });
    expect(report?.items[0]).toEqual({
      sampleId: "gpqa_diamond-1",
      epoch: 0,
      status: "correct",
      latencyMs: 100,
      prompt: INPUT,
      question: "Which option is correct?",
      choices: {
        A: "First choice",
        B: "Second choice",
        C: "Third choice",
        D: "Fourth choice",
      },
      modelAnswer: "The second option follows from the premise.\nAnswer: B",
      extractedAnswer: "B",
      correctAnswer: "B",
      correctAnswerText: "Second choice",
      reasoning: "The premise rules out the other three choices.",
      scorerExplanation: "Extracted answer for gpqa_diamond-1",
      subdomain: "Physics",
    });
    expect(report?.items[2]).toMatchObject({
      status: "no_answer",
      extractedAnswer: null,
    });
    expect(report?.items[3]?.modelAnswer).toBeNull();
  });

  it("returns null when no GPQA rows are present", () => {
    const nonGpqa = {
      ...row("task-1", 0, "C", null),
      task: "tau_bench_verified_airline",
    };

    expect(buildGpqaReport([nonGpqa])).toBeNull();
    expect(buildGpqaReport([])).toBeNull();
  });
});
