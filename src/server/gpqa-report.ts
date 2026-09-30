import { ScoreValue } from "../harness/core";
import { z } from "../internal/zod";
import type { BenchmarkResultRow } from "../results/parquet-schema";

export type GpqaReportStatus = "correct" | "wrong" | "no_answer" | "skipped";

export interface GpqaReportItem {
  readonly sampleId: string;
  readonly epoch: number;
  readonly status: GpqaReportStatus;
  readonly latencyMs: number | null;
  readonly prompt: string;
  readonly question: string;
  readonly choices: Readonly<Record<string, string>>;
  readonly modelAnswer: string | null;
  readonly extractedAnswer: string | null;
  readonly correctAnswer: string;
  readonly correctAnswerText: string | null;
  readonly reasoning: string | null;
  readonly scorerExplanation: string | null;
  readonly subdomain: string;
}

export interface GpqaReport {
  readonly task: "gpqa_diamond";
  readonly model: string;
  readonly totalGenerationTimeMs: number;
  readonly evaluations: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly wrong: number;
  readonly noAnswer: number;
  readonly skipped: number;
  readonly items: readonly GpqaReportItem[];
}

export const GpqaReportSchema = z.object({
  task: z.literal("gpqa_diamond"),
  model: z.string(),
  totalGenerationTimeMs: z.number(),
  evaluations: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(),
  wrong: z.number().int().nonnegative(),
  noAnswer: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      sampleId: z.string(),
      epoch: z.number().int().nonnegative(),
      status: z.enum(["correct", "wrong", "no_answer", "skipped"]),
      latencyMs: z.number().nullable(),
      prompt: z.string(),
      question: z.string(),
      choices: z.record(z.string(), z.string()),
      modelAnswer: z.string().nullable(),
      extractedAnswer: z.string().nullable(),
      correctAnswer: z.string(),
      correctAnswerText: z.string().nullable(),
      reasoning: z.string().nullable(),
      scorerExplanation: z.string().nullable(),
      subdomain: z.string(),
    })
  ),
});

interface ParsedPrompt {
  readonly question: string;
  readonly choices: Readonly<Record<string, string>>;
}

interface PersistedMessage {
  readonly role?: unknown;
  readonly content?: unknown;
  readonly reasoning?: unknown;
}

const PROMPT_PREFIX =
  "Answer the following multiple choice question. The last line of your response should be of the following format: 'Answer: $LETTER' (without quotes) where LETTER is one of ABCD.\n\n";

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

function parsePrompt(input: string | null): ParsedPrompt {
  if (input === null) {
    return { question: "", choices: {} };
  }
  const prompt = input.startsWith(PROMPT_PREFIX)
    ? input.slice(PROMPT_PREFIX.length)
    : input;
  const matches = [...prompt.matchAll(/(?:^|\n)([A-D])\) /gu)];
  if (matches.length !== 4) {
    return { question: prompt.trim(), choices: {} };
  }
  const first = matches[0];
  if (first === undefined || first.index === undefined) {
    return { question: prompt.trim(), choices: {} };
  }
  const choices: Record<string, string> = {};
  for (const [index, match] of matches.entries()) {
    const letter = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? prompt.length;
    if (letter !== undefined) {
      choices[letter] = prompt.slice(start, end).trim();
    }
  }
  return {
    question: prompt.slice(0, first.index).trim(),
    choices,
  };
}

function assistantMessage(
  row: BenchmarkResultRow
): PersistedMessage | undefined {
  const raw = parsedJson(row.messages);
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw
    .toReversed()
    .find(
      (message): message is PersistedMessage =>
        typeof message === "object" &&
        message !== null &&
        (message as PersistedMessage).role === "assistant"
    );
}

function subdomain(row: BenchmarkResultRow): string {
  const raw = parsedJson(row.metadata);
  if (typeof raw !== "object" || raw === null) {
    return "Unknown";
  }
  const value = (raw as { readonly subdomain?: unknown }).subdomain;
  return typeof value === "string" && value.trim().length > 0
    ? value
    : "Unknown";
}

function statusOf(scoreValue: string, answer: string | null): GpqaReportStatus {
  if (scoreValue === ScoreValue.Correct) {
    return "correct";
  }
  if (scoreValue === ScoreValue.Incorrect) {
    return answer === null ? "no_answer" : "wrong";
  }
  return "skipped";
}

function reportItem(row: BenchmarkResultRow): GpqaReportItem {
  const prompt = parsePrompt(row.input);
  const assistant = assistantMessage(row);
  const target = row.target?.trim().toUpperCase() ?? "";
  return {
    sampleId: row.sample_id,
    epoch: row.epoch,
    status: statusOf(row.score_value, row.answer),
    latencyMs: row.sample_generation_time_ms ?? null,
    prompt: row.input ?? "",
    question: prompt.question,
    choices: prompt.choices,
    modelAnswer:
      typeof assistant?.content === "string" ? assistant.content : null,
    extractedAnswer: row.answer,
    correctAnswer: target,
    correctAnswerText: prompt.choices[target] ?? null,
    reasoning:
      typeof assistant?.reasoning === "string" ? assistant.reasoning : null,
    scorerExplanation: row.explanation,
    subdomain: subdomain(row),
  };
}

export function buildGpqaReport(
  rows: readonly BenchmarkResultRow[]
): GpqaReport | null {
  const gpqaRows = rows.filter((row) => row.task === "gpqa_diamond");
  const [first] = gpqaRows;
  if (first === undefined) {
    return null;
  }
  const items = gpqaRows
    .map(reportItem)
    .toSorted(
      (a, b) =>
        a.epoch - b.epoch ||
        a.sampleId.localeCompare(b.sampleId, undefined, { numeric: true })
    );
  return {
    task: "gpqa_diamond",
    model: first.model,
    totalGenerationTimeMs: first.generation_time_ms,
    evaluations: items.length,
    correct: items.filter(({ status }) => status === "correct").length,
    incorrect: items.filter(
      ({ status }) => status === "wrong" || status === "no_answer"
    ).length,
    wrong: items.filter(({ status }) => status === "wrong").length,
    noAnswer: items.filter(({ status }) => status === "no_answer").length,
    skipped: items.filter(({ status }) => status === "skipped").length,
    items,
  };
}
