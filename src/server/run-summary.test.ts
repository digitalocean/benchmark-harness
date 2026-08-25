import { describe, expect, it } from "bun:test";

import type { BenchmarkResultRow } from "../results/parquet-schema";
import { summarizeRunRows } from "./run-summary";

function row(
  sampleId: string,
  epoch: number,
  scoreValue: "C" | "I" | "S",
  subdomain: string,
  explanation: string | null = null
): BenchmarkResultRow {
  return {
    format_version: 1,
    task: "gpqa_diamond",
    model: "provider/model",
    epochs: 2,
    temperature: 0.5,
    benchmark_config: null,
    created_at: "2026-08-14T10:00:00.000Z",
    accuracy: 0.75,
    total_questions: 2,
    correct_answers: 2,
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
    sample_id: sampleId,
    epoch,
    input: "question",
    target: "A",
    score_value: scoreValue,
    answer: scoreValue === "S" ? null : "A",
    explanation,
    scorer_trajectory: null,
    response_items: null,
    request_body: null,
    generation_ids: null,
    messages: null,
    metadata: JSON.stringify({ subdomain }),
  };
}

describe("summarizeRunRows", () => {
  it("builds overview, epoch, subdomain, and failure summaries", () => {
    const summary = summarizeRunRows([
      row("q1", 0, "C", "Physics"),
      row("q1", 1, "I", "Physics"),
      row("q2", 0, "C", "Chemistry"),
      row("q2", 1, "C", "Chemistry"),
      row(
        "q3",
        0,
        "S",
        "Physics",
        "Model error (skipped): HTTP 503 request abcdef123456"
      ),
      row(
        "q3",
        1,
        "S",
        "Physics",
        "Model error (skipped): HTTP 503 request abcdef999999"
      ),
    ]);

    expect(summary?.accuracy).toBe(0.75);
    expect(summary?.totalQuestions).toBe(2);
    expect(summary?.skippedQuestions).toBe(1);
    expect(summary?.evaluations).toBe(6);
    expect(summary?.skippedEvaluations).toBe(2);
    expect(summary?.epochResults.map(({ accuracy }) => accuracy)).toEqual([
      1, 0.5,
    ]);
    expect(
      summary?.subdomains.map(({ name, accuracy }) => ({ name, accuracy }))
    ).toEqual([
      { name: "Physics", accuracy: 0.5 },
      { name: "Chemistry", accuracy: 1 },
    ]);
    expect(summary?.failures).toEqual([
      {
        message: "Model error (skipped): HTTP <n> request <id>",
        count: 2,
      },
    ]);
  });
});
