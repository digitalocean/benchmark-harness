import { describe, expect, it } from "bun:test";

import { buildGpqaAnalytics } from "./gpqa-analytics";
import type { GpqaReportItem } from "./gpqa-report";

function item(
  overrides: Partial<GpqaReportItem> &
    Pick<GpqaReportItem, "sampleId" | "epoch" | "status">
): GpqaReportItem {
  return {
    latencyMs: 20_000,
    prompt: "Prompt",
    question: `Question ${overrides.sampleId}`,
    choices: { A: "One", B: "Two", C: "Three", D: "Four" },
    modelAnswer: "Reasoning\nAnswer: A",
    extractedAnswer: "A",
    correctAnswer: "A",
    correctAnswerText: "One",
    reasoning: "Reasoning",
    scorerExplanation: null,
    subdomain: "Physics",
    ...overrides,
  };
}

describe("GPQA diagnostics analytics", () => {
  it("derives consistency, quality, length, difficulty, and epoch trends", () => {
    const repeated = `${"the same repeated phrase has eight words exactly ".repeat(5)}\nAnswer: C`;
    const analytics = buildGpqaAnalytics([
      item({ sampleId: "q1", epoch: 0, status: "correct" }),
      item({
        sampleId: "q1",
        epoch: 1,
        status: "correct",
        latencyMs: 1_900_000,
      }),
      item({
        sampleId: "q2",
        epoch: 0,
        status: "wrong",
        extractedAnswer: "B",
        modelAnswer: "Answer: B",
      }),
      item({ sampleId: "q2", epoch: 1, status: "correct" }),
      item({
        sampleId: "q3",
        epoch: 0,
        status: "no_answer",
        correctAnswer: "C",
        correctAnswerText: "Three",
        extractedAnswer: null,
        modelAnswer: repeated,
        reasoning: null,
        latencyMs: 150_000,
      }),
      item({
        sampleId: "q3",
        epoch: 1,
        status: "wrong",
        correctAnswer: "C",
        correctAnswerText: "Three",
        extractedAnswer: "B",
        modelAnswer: "The answer may be B",
        reasoning: null,
        latencyMs: 700_000,
      }),
    ]);

    expect(analytics.epochConsistency).toEqual({
      questions: 3,
      consistentCorrect: 1,
      consistentIncorrect: 1,
      mixedOrIncomplete: 1,
      allSkipped: 0,
      singleObservation: 0,
    });
    expect(
      analytics.responseQuality.find(
        ({ name }) => name === "No answer extracted"
      )?.count
    ).toBe(1);
    expect(
      analytics.responseQuality.find(
        ({ name }) => name === "Likely repetition loop"
      )?.count
    ).toBe(1);
    expect(analytics.latencyVsCorrectness.map(({ label }) => label)).toEqual([
      "≤30s",
      "2–5m",
      "10–30m",
      ">30m",
    ]);
    expect(analytics.responseLengthVsCorrectness.length).toBeGreaterThan(0);
    expect(analytics.reasoningLengthVsCorrectness.length).toBeGreaterThan(0);
    expect(analytics.hardestQuestions[0]).toMatchObject({
      sampleId: "q3",
      correct: 0,
      evaluations: 2,
      noAnswer: 1,
    });
    expect(analytics.epochTrends).toHaveLength(2);
    expect(analytics.epochTrends[0]).toMatchObject({
      epoch: 0,
      evaluations: 3,
      correct: 1,
      noAnswer: 1,
    });
  });
});
