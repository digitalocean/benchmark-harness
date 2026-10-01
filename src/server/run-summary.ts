import { ScoreValue } from "../harness/core";
import { summarizeChunkRows } from "../results/parquet";
import type { BenchmarkResultRow } from "../results/parquet-schema";

export interface RunSummaryBreakdown {
  readonly name: string;
  readonly accuracy: number;
  readonly correctAnswers: number;
  readonly totalQuestions: number;
  readonly skippedQuestions: number;
}

export interface RunSummaryFailure {
  readonly message: string;
  readonly count: number;
}

export interface DetailedRunSummary {
  readonly task: string;
  readonly model: string;
  readonly epochs: number;
  readonly temperature: number | null;
  readonly createdAt: string;
  readonly accuracy: number;
  readonly correctAnswers: number;
  readonly totalQuestions: number;
  readonly skippedQuestions: number;
  readonly evaluations: number;
  readonly uniqueQuestions: number;
  readonly skippedEvaluations: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens: number;
  readonly reasoningTokens: number;
  readonly totalCost: number;
  readonly generationTimeMs: number;
  readonly epochResults: readonly RunSummaryBreakdown[];
  readonly subdomains: readonly RunSummaryBreakdown[];
  readonly failures: readonly RunSummaryFailure[];
}

function subdomainOf(row: BenchmarkResultRow): string {
  if (row.metadata === null) {
    return "Unknown";
  }
  try {
    const parsed: unknown = JSON.parse(row.metadata);
    if (parsed === null || typeof parsed !== "object") {
      return "Unknown";
    }
    const subdomain = (parsed as { readonly subdomain?: unknown }).subdomain;
    return typeof subdomain === "string" && subdomain.length > 0
      ? subdomain
      : "Unknown";
  } catch {
    return "Unknown";
  }
}

function breakdown(
  rows: readonly BenchmarkResultRow[],
  name: string
): RunSummaryBreakdown | null {
  const summary = summarizeChunkRows(rows);
  return summary === null
    ? null
    : {
        name,
        accuracy: summary.accuracy,
        correctAnswers: summary.correctAnswers,
        totalQuestions: summary.totalQuestions,
        skippedQuestions: summary.skippedQuestions,
      };
}

function groupedBreakdown(
  rows: readonly BenchmarkResultRow[],
  key: (row: BenchmarkResultRow) => string
): RunSummaryBreakdown[] {
  const groups = new Map<string, BenchmarkResultRow[]>();
  for (const row of rows) {
    const name = key(row);
    const group = groups.get(name);
    if (group === undefined) {
      groups.set(name, [row]);
    } else {
      group.push(row);
    }
  }
  return [...groups.entries()]
    .map(([name, group]) => breakdown(group, name))
    .filter((entry): entry is RunSummaryBreakdown => entry !== null);
}

function normalizedFailure(explanation: string): string {
  return explanation
    .replaceAll(/[0-9a-f]{8,}/gi, "<id>")
    .replaceAll(/\d+/g, "<n>")
    .slice(0, 200);
}

function failureSummary(
  rows: readonly BenchmarkResultRow[]
): RunSummaryFailure[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (
      row.explanation === null ||
      !/^(Model|Solver) error/u.test(row.explanation)
    ) {
      continue;
    }
    const message = normalizedFailure(row.explanation);
    counts.set(message, (counts.get(message) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count);
}

export function summarizeRunRows(
  rows: readonly BenchmarkResultRow[]
): DetailedRunSummary | null {
  const [first] = rows;
  const summary = summarizeChunkRows(rows);
  if (first === undefined || summary === null) {
    return null;
  }
  return {
    task: first.task,
    model: first.model,
    epochs: first.epochs,
    temperature: first.temperature,
    createdAt: first.created_at,
    accuracy: summary.accuracy,
    correctAnswers: summary.correctAnswers,
    totalQuestions: summary.totalQuestions,
    skippedQuestions: summary.skippedQuestions,
    evaluations: rows.length,
    uniqueQuestions: new Set(rows.map((row) => row.sample_id)).size,
    skippedEvaluations: rows.filter(
      (row) => row.score_value === ScoreValue.Skipped
    ).length,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    totalTokens: summary.totalTokens,
    cacheReadTokens: summary.cacheReadTokens,
    reasoningTokens: summary.reasoningTokens,
    totalCost: summary.totalCost,
    generationTimeMs: summary.generationTimeMs,
    epochResults: summary.epochResults.map((entry) => ({
      name: `Epoch ${entry.epoch + 1}`,
      accuracy: entry.accuracy,
      correctAnswers: entry.correctAnswers,
      totalQuestions: entry.totalQuestions,
      skippedQuestions: entry.skippedQuestions,
    })),
    subdomains: groupedBreakdown(rows, subdomainOf).sort(
      (a, b) => a.accuracy - b.accuracy
    ),
    failures: failureSummary(rows),
  };
}
