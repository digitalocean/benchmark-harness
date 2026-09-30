import type { GpqaReportItem } from "./gpqa-report";

export interface GpqaBucketAnalytics {
  readonly label: string;
  readonly evaluations: number;
  readonly correct: number;
  readonly accuracy: number | null;
}

export interface GpqaResponseDiagnostic {
  readonly name: string;
  readonly count: number;
  readonly rate: number | null;
}

export interface GpqaHardQuestion {
  readonly sampleId: string;
  readonly question: string;
  readonly subdomain: string;
  readonly evaluations: number;
  readonly correct: number;
  readonly skipped: number;
  readonly noAnswer: number;
  readonly accuracy: number | null;
  readonly averageLatencyMs: number | null;
}

export interface GpqaEpochTrend {
  readonly epoch: number;
  readonly evaluations: number;
  readonly correct: number;
  readonly skipped: number;
  readonly noAnswer: number;
  readonly accuracy: number | null;
  readonly averageLatencyMs: number | null;
  readonly averageResponseCharacters: number | null;
  readonly averageReasoningCharacters: number | null;
}

export interface GpqaAnalytics {
  readonly latencyVsCorrectness: readonly GpqaBucketAnalytics[];
  readonly epochConsistency: {
    readonly questions: number;
    readonly consistentCorrect: number;
    readonly consistentIncorrect: number;
    readonly mixedOrIncomplete: number;
    readonly allSkipped: number;
    readonly singleObservation: number;
  };
  readonly responseQuality: readonly GpqaResponseDiagnostic[];
  readonly responseLengthVsCorrectness: readonly GpqaBucketAnalytics[];
  readonly reasoningLengthVsCorrectness: readonly GpqaBucketAnalytics[];
  readonly hardestQuestions: readonly GpqaHardQuestion[];
  readonly epochTrends: readonly GpqaEpochTrend[];
}

interface NumericBucket {
  readonly label: string;
  readonly min: number;
  readonly max: number;
}

const LATENCY_BUCKETS: readonly NumericBucket[] = [
  { label: "≤30s", min: 0, max: 30_000 },
  { label: "30–60s", min: 30_000, max: 60_000 },
  { label: "1–2m", min: 60_000, max: 120_000 },
  { label: "2–5m", min: 120_000, max: 300_000 },
  { label: "5–10m", min: 300_000, max: 600_000 },
  { label: "10–30m", min: 600_000, max: 1_800_000 },
  { label: ">30m", min: 1_800_000, max: Number.POSITIVE_INFINITY },
];

const LENGTH_BUCKETS: readonly NumericBucket[] = [
  { label: "0", min: 0, max: 1 },
  { label: "1–500", min: 1, max: 501 },
  { label: "501–2k", min: 501, max: 2001 },
  { label: "2k–8k", min: 2001, max: 8001 },
  { label: ">8k", min: 8001, max: Number.POSITIVE_INFINITY },
];

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function evaluated(items: readonly GpqaReportItem[]): GpqaReportItem[] {
  return items.filter(({ status }) => status !== "skipped");
}

function average(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function bucketAnalytics(
  items: readonly GpqaReportItem[],
  buckets: readonly NumericBucket[],
  value: (item: GpqaReportItem) => number | null
): GpqaBucketAnalytics[] {
  return buckets.flatMap((bucket) => {
    const matches = evaluated(items).filter((item) => {
      const current = value(item);
      return current !== null && current >= bucket.min && current < bucket.max;
    });
    return matches.length === 0
      ? []
      : [
          {
            label: bucket.label,
            evaluations: matches.length,
            correct: matches.filter(({ status }) => status === "correct")
              .length,
            accuracy: rate(
              matches.filter(({ status }) => status === "correct").length,
              matches.length
            ),
          },
        ];
  });
}

function groupedBySample(
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

function epochConsistency(items: readonly GpqaReportItem[]) {
  const groups = groupedBySample(items);
  let consistentCorrect = 0;
  let consistentIncorrect = 0;
  let mixedOrIncomplete = 0;
  let allSkipped = 0;
  let singleObservation = 0;
  for (const group of groups.values()) {
    if (group.length === 1) {
      singleObservation += 1;
    } else if (group.every(({ status }) => status === "skipped")) {
      allSkipped += 1;
    } else if (group.every(({ status }) => status === "correct")) {
      consistentCorrect += 1;
    } else if (
      group.every(({ status }) => status === "wrong" || status === "no_answer")
    ) {
      consistentIncorrect += 1;
    } else {
      mixedOrIncomplete += 1;
    }
  }
  return {
    questions: groups.size,
    consistentCorrect,
    consistentIncorrect,
    mixedOrIncomplete,
    allSkipped,
    singleObservation,
  };
}

function hasRepetitionLoop(value: string): boolean {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length >= 20);
  const lineCounts = new Map<string, number>();
  for (const line of lines) {
    const count = (lineCounts.get(line) ?? 0) + 1;
    if (count >= 3) {
      return true;
    }
    lineCounts.set(line, count);
  }
  const words = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < 40) {
    return false;
  }
  const phraseCounts = new Map<string, number>();
  for (let index = 0; index <= words.length - 8; index += 1) {
    const phrase = words.slice(index, index + 8).join(" ");
    const count = (phraseCounts.get(phrase) ?? 0) + 1;
    if (count >= 4) {
      return true;
    }
    phraseCounts.set(phrase, count);
  }
  return false;
}

function responseQuality(
  items: readonly GpqaReportItem[]
): GpqaResponseDiagnostic[] {
  const candidates = evaluated(items);
  const matching = (
    name: string,
    predicate: (item: GpqaReportItem) => boolean
  ): GpqaResponseDiagnostic => {
    const count = candidates.filter(predicate).length;
    return { name, count, rate: rate(count, candidates.length) };
  };
  return [
    matching("Empty model response", ({ modelAnswer }) => !modelAnswer?.trim()),
    matching("No answer extracted", ({ extractedAnswer }) => {
      const answer = extractedAnswer?.trim().toUpperCase();
      return answer === undefined || !["A", "B", "C", "D"].includes(answer);
    }),
    matching("Missing canonical final Answer: X", ({ modelAnswer }) =>
      modelAnswer === null
        ? true
        : !/Answer:\s*[A-D]\s*$/iu.test(modelAnswer.trim())
    ),
    matching(
      "Multiple Answer: X declarations",
      ({ modelAnswer }) =>
        ((modelAnswer ?? "").match(/Answer:\s*[A-D]/giu) ?? []).length > 1
    ),
    matching("Likely repetition loop", ({ modelAnswer }) =>
      hasRepetitionLoop(modelAnswer ?? "")
    ),
    matching("No exposed reasoning", ({ reasoning }) => !reasoning?.trim()),
    matching(
      "Very long response (>20k characters)",
      ({ modelAnswer }) => (modelAnswer?.length ?? 0) > 20_000
    ),
  ];
}

function hardestQuestions(
  items: readonly GpqaReportItem[]
): GpqaHardQuestion[] {
  return [...groupedBySample(items).entries()]
    .flatMap(([sampleId, group]) => {
      const scored = evaluated(group);
      if (scored.length === 0) {
        return [];
      }
      const correct = scored.filter(
        ({ status }) => status === "correct"
      ).length;
      const first = group[0];
      if (first === undefined) {
        return [];
      }
      return [
        {
          sampleId,
          question: first.question,
          subdomain: first.subdomain,
          evaluations: scored.length,
          correct,
          skipped: group.filter(({ status }) => status === "skipped").length,
          noAnswer: scored.filter(({ status }) => status === "no_answer")
            .length,
          accuracy: rate(correct, scored.length),
          averageLatencyMs: average(
            scored.flatMap(({ latencyMs }) =>
              latencyMs === null ? [] : [latencyMs]
            )
          ),
        },
      ];
    })
    .sort(
      (a, b) =>
        (a.accuracy ?? 1) - (b.accuracy ?? 1) ||
        b.noAnswer - a.noAnswer ||
        (b.averageLatencyMs ?? 0) - (a.averageLatencyMs ?? 0)
    )
    .slice(0, 20);
}

function epochTrends(items: readonly GpqaReportItem[]): GpqaEpochTrend[] {
  const groups = new Map<number, GpqaReportItem[]>();
  for (const item of items) {
    const group = groups.get(item.epoch) ?? [];
    group.push(item);
    groups.set(item.epoch, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([epoch, group]) => {
      const scored = evaluated(group);
      const correct = scored.filter(
        ({ status }) => status === "correct"
      ).length;
      return {
        epoch,
        evaluations: scored.length,
        correct,
        skipped: group.filter(({ status }) => status === "skipped").length,
        noAnswer: scored.filter(({ status }) => status === "no_answer").length,
        accuracy: rate(correct, scored.length),
        averageLatencyMs: average(
          scored.flatMap(({ latencyMs }) =>
            latencyMs === null ? [] : [latencyMs]
          )
        ),
        averageResponseCharacters: average(
          scored.map(({ modelAnswer }) => modelAnswer?.length ?? 0)
        ),
        averageReasoningCharacters: average(
          scored.map(({ reasoning }) => reasoning?.length ?? 0)
        ),
      };
    });
}

export function buildGpqaAnalytics(
  items: readonly GpqaReportItem[]
): GpqaAnalytics {
  return {
    latencyVsCorrectness: bucketAnalytics(
      items,
      LATENCY_BUCKETS,
      ({ latencyMs }) => latencyMs
    ),
    epochConsistency: epochConsistency(items),
    responseQuality: responseQuality(items),
    responseLengthVsCorrectness: bucketAnalytics(
      items,
      LENGTH_BUCKETS,
      ({ modelAnswer }) => modelAnswer?.length ?? 0
    ),
    reasoningLengthVsCorrectness: bucketAnalytics(
      items,
      LENGTH_BUCKETS,
      ({ reasoning }) => reasoning?.length ?? 0
    ),
    hardestQuestions: hardestQuestions(items),
    epochTrends: epochTrends(items),
  };
}
