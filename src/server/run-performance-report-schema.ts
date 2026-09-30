import { z } from "../internal/zod";

export const RUN_PERFORMANCE_REPORT_SCHEMA_VERSION = 1;

const NullableNumberSchema = z.number().nullable();

const LatencyStatsSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  p50: NullableNumberSchema,
  p75: NullableNumberSchema,
  p90: NullableNumberSchema,
  p95: NullableNumberSchema,
  mean: NullableNumberSchema,
  max: NullableNumberSchema,
});

const ErrorStatusCountSchema = z.object({
  status: z.string().min(1),
  count: z.number().int().positive(),
});

export const RequestPerfSchema = z.object({
  requestCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  successfulCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  retryAttemptCount: z.number().int().nonnegative(),
  postProcessingFailureCount: z.number().int().nonnegative(),
  successRate: NullableNumberSchema,
  errorRate: NullableNumberSchema,
  retryAttemptRate: NullableNumberSchema,
  postProcessingFailureRate: NullableNumberSchema,
  latencyMs: LatencyStatsSchema,
  observedWindowMs: NullableNumberSchema,
  peakInFlight: NullableNumberSchema,
  averageInFlight: NullableNumberSchema,
  throughputPerMinute: NullableNumberSchema,
  outputTokensTotal: z.number().nonnegative(),
  outputTokenDurationMs: z.number().nonnegative(),
  effectiveOutputTokensPerSecond: NullableNumberSchema,
  errorStatusCounts: z.array(ErrorStatusCountSchema),
});

const GpqaBucketSchema = z.object({
  label: z.string(),
  evaluations: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  accuracy: NullableNumberSchema,
});

const GpqaDiagnosticSchema = z.object({
  name: z.string(),
  count: z.number().int().nonnegative(),
  rate: NullableNumberSchema,
});

const GpqaHardQuestionSchema = z.object({
  sampleId: z.string(),
  question: z.string(),
  subdomain: z.string(),
  evaluations: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  noAnswer: z.number().int().nonnegative(),
  accuracy: NullableNumberSchema,
  averageLatencyMs: NullableNumberSchema,
});

const GpqaEpochTrendSchema = z.object({
  epoch: z.number().int().nonnegative(),
  evaluations: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  noAnswer: z.number().int().nonnegative(),
  accuracy: NullableNumberSchema,
  averageLatencyMs: NullableNumberSchema,
  averageResponseCharacters: NullableNumberSchema,
  averageReasoningCharacters: NullableNumberSchema,
});

export const GpqaAnalyticsSchema = z.object({
  latencyVsCorrectness: z.array(GpqaBucketSchema),
  epochConsistency: z.object({
    questions: z.number().int().nonnegative(),
    consistentCorrect: z.number().int().nonnegative(),
    consistentIncorrect: z.number().int().nonnegative(),
    mixedOrIncomplete: z.number().int().nonnegative(),
    allSkipped: z.number().int().nonnegative(),
    singleObservation: z.number().int().nonnegative(),
  }),
  responseQuality: z.array(GpqaDiagnosticSchema),
  responseLengthVsCorrectness: z.array(GpqaBucketSchema),
  reasoningLengthVsCorrectness: z.array(GpqaBucketSchema),
  hardestQuestions: z.array(GpqaHardQuestionSchema),
  epochTrends: z.array(GpqaEpochTrendSchema),
});

export const GpqaPerformanceSummarySchema = z.object({
  task: z.literal("gpqa_diamond"),
  model: z.string(),
  totalGenerationTimeMs: z.number(),
  evaluations: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(),
  wrong: z.number().int().nonnegative(),
  noAnswer: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const RunPerformanceReportPayloadSchema = z.object({
  schemaVersion: z.literal(RUN_PERFORMANCE_REPORT_SCHEMA_VERSION),
  runId: z.string().min(1),
  computedAt: z.string().min(1),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  requestPerf: RequestPerfSchema,
  gpqa: z
    .object({
      summary: GpqaPerformanceSummarySchema,
      analytics: GpqaAnalyticsSchema,
    })
    .nullable(),
});

export type RequestPerf = z.infer<typeof RequestPerfSchema>;
export type RunPerformanceReportPayload = z.infer<
  typeof RunPerformanceReportPayloadSchema
>;
