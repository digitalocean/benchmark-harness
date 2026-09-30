import { describe, expect, it } from "bun:test";

import type { GpqaReport, GpqaReportItem } from "./gpqa-report";
import {
  gpqaFailureBands,
  gpqaRetryArmArgs,
  sampleIdsForFailureCounts,
} from "./gpqa-retry-campaign";
import { buildGpqaRetryCampaignReport } from "./gpqa-retry-report";
import type { GpqaRetryCampaign } from "./gpqa-retry-store";
import type { RunArgs } from "./run-registry";

function item(
  sampleId: string,
  epoch: number,
  status: GpqaReportItem["status"],
  extractedAnswer: string | null = status === "correct" ? "A" : "B"
): GpqaReportItem {
  return {
    sampleId,
    epoch,
    status,
    latencyMs: 1000 + epoch,
    prompt: "Prompt",
    question: `Question ${sampleId}`,
    choices: { A: "Correct", B: "Wrong", C: "Other", D: "Other" },
    modelAnswer: `Reasoning ${epoch}\nAnswer: ${extractedAnswer ?? "none"}`,
    extractedAnswer,
    correctAnswer: "A",
    correctAnswerText: "Correct",
    reasoning: `Reasoning ${epoch}`,
    scorerExplanation: null,
    subdomain: "Physics",
  };
}

function report(items: readonly GpqaReportItem[]): GpqaReport {
  return {
    task: "gpqa_diamond",
    model: "model",
    totalGenerationTimeMs: 1000,
    evaluations: items.length,
    correct: items.filter(({ status }) => status === "correct").length,
    incorrect: items.filter(({ status }) => status !== "correct").length,
    wrong: items.filter(({ status }) => status === "wrong").length,
    noAnswer: items.filter(({ status }) => status === "no_answer").length,
    skipped: items.filter(({ status }) => status === "skipped").length,
    items,
  };
}

function armArgs(campaignId: string, arm: "original" | "comparison"): RunArgs {
  return {
    benchmark: "gpqa_diamond",
    runKind: "gpqa_retry_arm",
    sourceRunId: "source",
    campaignId,
    campaignArm: arm,
    sampleIds: ["q1", "q2"],
    inference: {
      baseUrl: "https://example.com/v1",
      model: `${arm}-model`,
      temperature: 1,
    },
    execution: { epochs: 2, concurrency: 2 },
  };
}

describe("GPQA retry campaigns", () => {
  const sourceItems = [
    item("q1", 0, "wrong"),
    item("q1", 1, "skipped", null),
    item("q1", 2, "no_answer", null),
    item("q2", 0, "correct"),
    item("q2", 1, "wrong"),
    item("q2", 2, "correct"),
    item("q3", 0, "correct"),
    item("q3", 1, "correct"),
    item("q3", 2, "correct"),
  ];

  it("counts every non-correct outcome, including skipped, in failure bands", () => {
    const bands = gpqaFailureBands(sourceItems, 3);
    expect(bands).toEqual([
      { failures: 3, epochs: 3, questionCount: 1, sampleIds: ["q1"] },
      { failures: 1, epochs: 3, questionCount: 1, sampleIds: ["q2"] },
    ]);
    expect(sampleIdsForFailureCounts(bands, [3, 1])).toEqual(["q1", "q2"]);
  });

  it("uses selected samples and independent repetitions for each arm", () => {
    const sourceArgs: RunArgs = {
      benchmark: "gpqa_diamond",
      inference: {
        baseUrl: "https://source.example.com/v1",
        model: "source-model",
        temperature: 1,
      },
      execution: {
        epochs: 3,
        concurrency: 8,
        unordered: true,
        start: 10,
        end: 20,
        maxRetries: 6,
      },
    };
    const args = gpqaRetryArmArgs({
      sourceRunId: "source",
      sourceArgs,
      campaignId: "campaign",
      campaignArm: "comparison",
      sampleIds: ["q1", "q2"],
      arm: {
        apiKey: "not-persisted",
        repetitions: 5,
        concurrency: 2,
        unordered: false,
        maxRetries: 1,
      },
      inference: {
        baseUrl: "https://alternate.example.com/v1",
        model: "alternate-model",
        temperature: 0.5,
      },
      triggeredByEmail: "person@digitalocean.com",
    });

    expect(args).toMatchObject({
      runKind: "gpqa_retry_arm",
      sourceRunId: "source",
      campaignId: "campaign",
      campaignArm: "comparison",
      sampleIds: ["q1", "q2"],
      inference: {
        baseUrl: "https://alternate.example.com/v1",
        model: "alternate-model",
      },
      execution: {
        epochs: 5,
        concurrency: 2,
        unordered: false,
        maxRetries: 1,
      },
    });
    expect(args.execution).not.toHaveProperty("start");
    expect(JSON.stringify(args)).not.toContain("not-persisted");
  });

  it("aligns full source and two-arm attempts for comparison", () => {
    const campaignId = "campaign";
    const campaign: GpqaRetryCampaign = {
      id: campaignId,
      sourceRunId: "source",
      status: "succeeded",
      selectedFailureCounts: [3, 1],
      sampleIds: ["q1", "q2"],
      sourceEpochs: 3,
      originalRunId: "original",
      comparisonRunId: "comparison",
      originalConfig: armArgs(campaignId, "original"),
      comparisonConfig: armArgs(campaignId, "comparison"),
      triggeredByEmail: "person@digitalocean.com",
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(1).toISOString(),
      failureReason: null,
      uploadStatus: "complete",
      uploadError: null,
      uploadedAt: new Date(2).toISOString(),
      spacesBucket: "bucket",
      spacesPrefix: "prefix",
      manifestKey: "manifest",
    };
    const originalItems = [
      item("q1", 0, "correct"),
      item("q1", 1, "wrong"),
      item("q2", 0, "correct"),
      item("q2", 1, "correct"),
    ];
    const comparisonItems = [
      item("q1", 0, "correct"),
      item("q1", 1, "correct"),
      item("q2", 0, "wrong"),
      item("q2", 1, "wrong"),
    ];
    const comparison = buildGpqaRetryCampaignReport({
      campaign,
      source: report(sourceItems),
      original: report(originalItems),
      comparison: report(comparisonItems),
    });

    expect(comparison.questions).toHaveLength(2);
    expect(comparison.questions[0]).toMatchObject({
      sampleId: "q1",
      failureCount: 3,
      sourceAttempts: sourceItems.slice(0, 3),
      originalAttempts: originalItems.slice(0, 2),
      comparisonAttempts: comparisonItems.slice(0, 2),
    });
    expect(comparison.originalSummary).toMatchObject({
      accuracy: 0.75,
      recoveredQuestions: 2,
      recoveryRate: 1,
    });
    expect(comparison.comparisonSummary).toMatchObject({
      accuracy: 0.5,
      recoveredQuestions: 1,
      recoveryRate: 0.5,
    });

    const partial = buildGpqaRetryCampaignReport({
      campaign: { ...campaign, status: "running" },
      source: report(sourceItems),
    });
    expect(partial.status).toBe("running");
    expect(partial.questions[0]).toMatchObject({
      sourceAttempts: sourceItems.slice(0, 3),
      originalAttempts: [],
      comparisonAttempts: [],
    });
    expect(partial.originalSummary.evaluations).toBe(0);
    expect(partial.comparisonSummary?.evaluations).toBe(0);
  });
});
