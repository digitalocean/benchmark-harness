import type { GpqaReport, GpqaReportItem } from "./gpqa-report";
import type { GpqaRetryCampaign } from "./gpqa-retry-store";
import type { RunInference } from "./run-registry";

export interface GpqaRetryArmSummary {
  readonly evaluations: number;
  readonly correct: number;
  readonly accuracy: number | null;
  readonly recoveredQuestions: number;
  readonly selectedQuestions: number;
  readonly recoveryRate: number | null;
  readonly consistentCorrectQuestions: number;
  readonly averageLatencyMs: number | null;
  readonly answerDistribution: Readonly<Record<string, number>>;
}

export interface GpqaRetryQuestionComparison {
  readonly sampleId: string;
  readonly failureCount: number;
  readonly sourceEpochs: number;
  readonly question: string;
  readonly choices: Readonly<Record<string, string>>;
  readonly correctAnswer: string;
  readonly correctAnswerText: string | null;
  readonly subdomain: string;
  readonly sourceAttempts: readonly GpqaReportItem[];
  readonly originalAttempts: readonly GpqaReportItem[];
  readonly comparisonAttempts: readonly GpqaReportItem[];
}

export interface GpqaRetryCampaignReport {
  readonly campaignId: string;
  readonly sourceRunId: string;
  readonly status: GpqaRetryCampaign["status"];
  readonly generatedAt: string;
  readonly selectedFailureCounts: readonly number[];
  readonly sourceEpochs: number;
  readonly originalInference: RunInference;
  readonly comparisonInference: RunInference | null;
  readonly sourceSummary: GpqaRetryArmSummary;
  readonly originalSummary: GpqaRetryArmSummary;
  readonly comparisonSummary: GpqaRetryArmSummary | null;
  readonly questions: readonly GpqaRetryQuestionComparison[];
}

function groupBySample(
  items: readonly GpqaReportItem[]
): Map<string, GpqaReportItem[]> {
  const groups = new Map<string, GpqaReportItem[]>();
  for (const item of items) {
    const group = groups.get(item.sampleId) ?? [];
    group.push(item);
    groups.set(item.sampleId, group);
  }
  return groups;
}

function summary(
  items: readonly GpqaReportItem[],
  sampleIds: readonly string[]
): GpqaRetryArmSummary {
  const groups = groupBySample(items);
  const correct = items.filter(({ status }) => status === "correct").length;
  const recoveredQuestions = sampleIds.filter((sampleId) =>
    groups.get(sampleId)?.some(({ status }) => status === "correct")
  ).length;
  const consistentCorrectQuestions = sampleIds.filter((sampleId) => {
    const attempts = groups.get(sampleId) ?? [];
    return (
      attempts.length > 0 &&
      attempts.every(({ status }) => status === "correct")
    );
  }).length;
  const latencies = items.flatMap(({ latencyMs }) =>
    latencyMs === null ? [] : [latencyMs]
  );
  const answerDistribution: Record<string, number> = {};
  for (const item of items) {
    const answer = item.extractedAnswer?.trim().toUpperCase() || "No answer";
    answerDistribution[answer] = (answerDistribution[answer] ?? 0) + 1;
  }
  return {
    evaluations: items.length,
    correct,
    accuracy: items.length === 0 ? null : correct / items.length,
    recoveredQuestions,
    selectedQuestions: sampleIds.length,
    recoveryRate:
      sampleIds.length === 0 ? null : recoveredQuestions / sampleIds.length,
    consistentCorrectQuestions,
    averageLatencyMs:
      latencies.length === 0
        ? null
        : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    answerDistribution,
  };
}

export function buildGpqaRetryCampaignReport(input: {
  readonly campaign: GpqaRetryCampaign;
  readonly source: GpqaReport;
  readonly original?: GpqaReport | undefined;
  readonly comparison?: GpqaReport | undefined;
}): GpqaRetryCampaignReport {
  const sourceGroups = groupBySample(input.source.items);
  const originalGroups = groupBySample(input.original?.items ?? []);
  const comparisonGroups = groupBySample(input.comparison?.items ?? []);
  const questions = input.campaign.sampleIds.flatMap((sampleId) => {
    const sourceAttempts = sourceGroups.get(sampleId) ?? [];
    const first = sourceAttempts[0];
    if (first === undefined) {
      return [];
    }
    return [
      {
        sampleId,
        failureCount: sourceAttempts.filter(
          ({ status }) => status !== "correct"
        ).length,
        sourceEpochs: input.campaign.sourceEpochs,
        question: first.question,
        choices: first.choices,
        correctAnswer: first.correctAnswer,
        correctAnswerText: first.correctAnswerText,
        subdomain: first.subdomain,
        sourceAttempts,
        originalAttempts: originalGroups.get(sampleId) ?? [],
        comparisonAttempts: comparisonGroups.get(sampleId) ?? [],
      },
    ];
  });
  return {
    campaignId: input.campaign.id,
    sourceRunId: input.campaign.sourceRunId,
    status: input.campaign.status,
    generatedAt: new Date().toISOString(),
    selectedFailureCounts: input.campaign.selectedFailureCounts,
    sourceEpochs: input.campaign.sourceEpochs,
    originalInference: input.campaign.originalConfig.inference,
    comparisonInference: input.campaign.comparisonConfig?.inference ?? null,
    sourceSummary: summary(
      input.source.items.filter(({ sampleId }) =>
        input.campaign.sampleIds.includes(sampleId)
      ),
      input.campaign.sampleIds
    ),
    originalSummary: summary(
      input.original?.items ?? [],
      input.campaign.sampleIds
    ),
    comparisonSummary:
      input.campaign.comparisonConfig === null
        ? null
        : summary(input.comparison?.items ?? [], input.campaign.sampleIds),
    questions,
  };
}
