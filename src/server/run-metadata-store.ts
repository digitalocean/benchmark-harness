import { Either } from "../internal/either";
import type { MysqlExecutor, MysqlValue } from "../internal/mysql";
import { firstZodIssueMessage, parseSchema, z } from "../internal/zod";
import type {
  RunArgs,
  RunRecord,
  RunStatus,
  UploadStatus,
} from "./run-registry";

export interface RunMetadata {
  readonly id: string;
  readonly status: RunStatus;
  readonly args: RunArgs;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly exitCode: number | null;
  readonly expectedQuestions: number;
  readonly completedQuestions: number;
  readonly skippedQuestions: number;
  readonly completionPercentage: number;
  readonly totalEvaluations: number;
  readonly completedEvaluations: number;
  readonly skippedEvaluations: number;
  readonly qualityScore: number | null;
  readonly disabled: boolean;
  readonly cancelRequestedAt: string | null;
  readonly failureReason: string | null;
  readonly uploadStatus: UploadStatus;
  readonly uploadError: string | null;
  readonly uploadedAt: string | null;
  readonly spacesBucket: string | null;
  readonly spacesPrefix: string | null;
  readonly manifestKey: string | null;
  readonly triggeredByEmail: string | null;
}

export interface RunMetadataStore {
  readonly upsert: (record: RunRecord) => Promise<void>;
  readonly setDisabled: (id: string, disabled: boolean) => Promise<void>;
  readonly get: (id: string) => Promise<RunMetadata | undefined>;
  readonly list: () => Promise<readonly RunMetadata[]>;
}

export class RunMetadataStoreError extends Error {
  override readonly name = "RunMetadataStoreError";
}

const DateValueSchema = z.union([z.date(), z.string()]);
const NullableDateValueSchema = DateValueSchema.nullable();
const NullableNumberSchema = z.coerce.number().nullable();
const NullableStringSchema = z.string().nullable();
const NullableBooleanSchema = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .nullable();

const RunMetadataRowSchema = z.object({
  id: z.string().min(1),
  benchmark: z.enum([
    "gpqa_diamond",
    "tau_bench_verified_airline",
    "deep_swe",
    "swe_bench_verified",
    "terminal_bench",
    "swe_atlas_qa",
    "swe_atlas_tw",
    "swe_atlas_rf",
  ]),
  run_kind: z.enum(["benchmark", "gpqa_retry_arm"]).default("benchmark"),
  source_run_id: NullableStringSchema.default(null),
  campaign_id: NullableStringSchema.default(null),
  campaign_arm: z.enum(["original", "comparison"]).nullable().default(null),
  sample_ids_json: z
    .union([z.string(), z.array(z.string().min(1))])
    .nullable()
    .default(null),
  model: z.string().min(1),
  judge_model: NullableStringSchema,
  base_url: z.url(),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  disabled: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  started_at: DateValueSchema,
  finished_at: NullableDateValueSchema,
  cancel_requested_at: NullableDateValueSchema,
  exit_code: NullableNumberSchema,
  failure_reason: NullableStringSchema,
  expected_questions: z.coerce.number().int().min(0),
  completed_questions: z.coerce.number().int().min(0),
  skipped_questions: z.coerce.number().int().min(0),
  completion_percentage: z.coerce.number().min(0).max(100),
  total_evaluations: z.coerce.number().int().min(0),
  completed_evaluations: z.coerce.number().int().min(0),
  skipped_evaluations: z.coerce.number().int().min(0),
  quality_score: z.coerce.number().min(0).max(1).nullable(),
  epochs: z.coerce.number().int().positive(),
  concurrency: z.coerce.number().int().positive(),
  unordered: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  row_limit: NullableNumberSchema,
  range_start: NullableNumberSchema,
  range_end: NullableNumberSchema,
  max_retries: NullableNumberSchema,
  temperature: z.coerce.number(),
  max_tokens: NullableNumberSchema,
  reasoning_effort: z
    .enum(["xhigh", "high", "medium", "low", "minimal", "none"])
    .nullable(),
  timeout_ms: NullableNumberSchema,
  completion_timeout_ms: NullableNumberSchema,
  endpoint_id: NullableStringSchema,
  cost_tier: z.enum(["low", "medium", "high", "xhigh", "max"]).nullable(),
  provider_sort: z
    .enum(["price", "throughput", "latency", "exacto"])
    .nullable(),
  provider_only: NullableStringSchema,
  allow_fallbacks: NullableBooleanSchema,
  cloudflare_version: NullableStringSchema,
  cost_quality_tradeoff: NullableNumberSchema,
  pin_model: NullableBooleanSchema,
  log_level: NullableStringSchema,
  upload_status: z.enum(["pending", "uploading", "complete", "failed"]),
  upload_error: NullableStringSchema,
  uploaded_at: NullableDateValueSchema,
  spaces_bucket: NullableStringSchema,
  spaces_prefix: NullableStringSchema,
  manifest_key: NullableStringSchema,
  triggered_by_email: z
    .string()
    .email()
    .regex(/@digitalocean\.com$/i)
    .nullable(),
});

type RunMetadataRow = z.infer<typeof RunMetadataRowSchema>;

const COLUMNS = `
  id, benchmark, run_kind, source_run_id, campaign_id, campaign_arm, sample_ids_json,
  model, judge_model, base_url, status, disabled, started_at, finished_at,
  cancel_requested_at, exit_code, failure_reason, expected_questions, completed_questions,
  skipped_questions, completion_percentage, total_evaluations,
  completed_evaluations, skipped_evaluations, quality_score, epochs, concurrency, unordered, row_limit, range_start,
  range_end, max_retries, temperature, max_tokens,
  reasoning_effort, timeout_ms, completion_timeout_ms, endpoint_id, cost_tier, provider_sort,
  provider_only, allow_fallbacks,
  cloudflare_version, cost_quality_tradeoff, pin_model, log_level,
  upload_status, upload_error, uploaded_at, spaces_bucket, spaces_prefix,
  manifest_key, triggered_by_email
`;

const UPSERT_SQL = `
INSERT INTO benchmark_runs (
  ${COLUMNS}, args_json
) VALUES (${Array.from({ length: 54 }, () => "?").join(", ")})
ON DUPLICATE KEY UPDATE
  benchmark = VALUES(benchmark),
  run_kind = VALUES(run_kind),
  source_run_id = VALUES(source_run_id),
  campaign_id = VALUES(campaign_id),
  campaign_arm = VALUES(campaign_arm),
  sample_ids_json = VALUES(sample_ids_json),
  model = VALUES(model),
  judge_model = VALUES(judge_model),
  base_url = VALUES(base_url),
  status = VALUES(status),
  disabled = VALUES(disabled),
  started_at = VALUES(started_at),
  finished_at = VALUES(finished_at),
  cancel_requested_at = VALUES(cancel_requested_at),
  exit_code = VALUES(exit_code),
  failure_reason = VALUES(failure_reason),
  expected_questions = VALUES(expected_questions),
  completed_questions = VALUES(completed_questions),
  skipped_questions = VALUES(skipped_questions),
  completion_percentage = VALUES(completion_percentage),
  total_evaluations = VALUES(total_evaluations),
  completed_evaluations = VALUES(completed_evaluations),
  skipped_evaluations = VALUES(skipped_evaluations),
  quality_score = VALUES(quality_score),
  epochs = VALUES(epochs),
  concurrency = VALUES(concurrency),
  unordered = VALUES(unordered),
  row_limit = VALUES(row_limit),
  range_start = VALUES(range_start),
  range_end = VALUES(range_end),
  max_retries = VALUES(max_retries),
  temperature = VALUES(temperature),
  max_tokens = VALUES(max_tokens),
  reasoning_effort = VALUES(reasoning_effort),
  timeout_ms = VALUES(timeout_ms),
  completion_timeout_ms = VALUES(completion_timeout_ms),
  endpoint_id = VALUES(endpoint_id),
  cost_tier = VALUES(cost_tier),
  provider_sort = VALUES(provider_sort),
  provider_only = VALUES(provider_only),
  allow_fallbacks = VALUES(allow_fallbacks),
  cloudflare_version = VALUES(cloudflare_version),
  cost_quality_tradeoff = VALUES(cost_quality_tradeoff),
  pin_model = VALUES(pin_model),
  log_level = VALUES(log_level),
  upload_status = VALUES(upload_status),
  upload_error = VALUES(upload_error),
  uploaded_at = VALUES(uploaded_at),
  spaces_bucket = VALUES(spaces_bucket),
  spaces_prefix = VALUES(spaces_prefix),
  manifest_key = VALUES(manifest_key),
  triggered_by_email = VALUES(triggered_by_email),
  args_json = VALUES(args_json)
`;

function dateValue(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function providerOnly(value: string | null): readonly string[] | undefined {
  if (value === null) {
    return undefined;
  }
  const parsedJson = Either.try((): unknown => JSON.parse(value));
  if (Either.isLeft(parsedJson)) {
    throw new RunMetadataStoreError("Invalid provider_only JSON in MySQL");
  }
  const parsed = parseSchema(
    z.array(z.string().min(1)).min(1),
    parsedJson.right
  );
  if (Either.isLeft(parsed)) {
    throw new RunMetadataStoreError(
      `Invalid provider_only value in MySQL: ${firstZodIssueMessage(parsed.left)}`
    );
  }
  return parsed.right;
}

function sampleIds(
  value: string | readonly string[] | null
): readonly string[] | undefined {
  if (value === null) {
    return undefined;
  }
  const decodedJson =
    typeof value === "string"
      ? Either.try((): unknown => JSON.parse(value))
      : Either.right(value);
  if (Either.isLeft(decodedJson)) {
    throw new RunMetadataStoreError("Invalid sample_ids_json JSON in MySQL");
  }
  const decoded = decodedJson.right;
  const parsed = parseSchema(z.array(z.string().min(1)).min(1), decoded);
  if (Either.isLeft(parsed)) {
    throw new RunMetadataStoreError(
      `Invalid sample_ids_json value in MySQL: ${firstZodIssueMessage(parsed.left)}`
    );
  }
  return parsed.right;
}

function isoDate(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  const date =
    value instanceof Date
      ? value
      : new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) {
    throw new RunMetadataStoreError(`Invalid MySQL date value: ${value}`);
  }
  return date.toISOString();
}

export function recordToMetadata(record: RunRecord): RunMetadata {
  return {
    id: record.id,
    status: record.status,
    args: record.args,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    exitCode: record.exitCode,
    expectedQuestions: record.expectedQuestions,
    completedQuestions: record.completedQuestions,
    skippedQuestions: record.skippedQuestions,
    completionPercentage: record.completionPercentage,
    totalEvaluations: record.totalEvaluations,
    completedEvaluations: record.completedEvaluations,
    skippedEvaluations: record.skippedEvaluations,
    qualityScore: record.qualityScore,
    disabled: record.disabled,
    cancelRequestedAt: record.cancelRequestedAt,
    failureReason: record.failureReason,
    uploadStatus: record.uploadStatus,
    uploadError: record.uploadError,
    uploadedAt: record.uploadedAt,
    spacesBucket: record.spacesBucket,
    spacesPrefix: record.spacesPrefix,
    manifestKey: record.manifestKey,
    triggeredByEmail: record.args.triggeredByEmail ?? null,
  };
}

function rowToMetadata(input: unknown): RunMetadata {
  const parsed = parseSchema(RunMetadataRowSchema, input);
  if (Either.isLeft(parsed)) {
    throw new RunMetadataStoreError(
      `Invalid benchmark_runs row: ${firstZodIssueMessage(parsed.left)}`
    );
  }
  const row: RunMetadataRow = parsed.right;
  const pinModel = row.pin_model === null ? undefined : Boolean(row.pin_model);
  const providerOnlyValue = providerOnly(row.provider_only);
  const sampleIdsValue = sampleIds(row.sample_ids_json);
  return {
    id: row.id,
    status: row.status,
    disabled: Boolean(row.disabled),
    args: {
      benchmark: row.benchmark,
      ...(row.run_kind !== "benchmark" && { runKind: row.run_kind }),
      ...(row.source_run_id !== null && { sourceRunId: row.source_run_id }),
      ...(row.campaign_id !== null && { campaignId: row.campaign_id }),
      ...(row.campaign_arm !== null && { campaignArm: row.campaign_arm }),
      ...(sampleIdsValue !== undefined && { sampleIds: sampleIdsValue }),
      ...(row.triggered_by_email !== null && {
        triggeredByEmail: row.triggered_by_email,
      }),
      ...(row.judge_model !== null && { judgeModel: row.judge_model }),
      inference: {
        baseUrl: row.base_url,
        model: row.model,
        temperature: row.temperature,
        ...(row.max_tokens !== null && { maxTokens: row.max_tokens }),
        ...(row.reasoning_effort !== null && {
          reasoningEffort: row.reasoning_effort,
        }),
        ...(row.timeout_ms !== null && { timeoutMs: row.timeout_ms }),
        ...(row.completion_timeout_ms !== null && {
          completionTimeoutMs: row.completion_timeout_ms,
        }),
        ...(row.endpoint_id !== null && { endpointId: row.endpoint_id }),
        ...(row.cost_tier !== null && {
          costTier: row.cost_tier,
        }),
        ...(row.provider_sort !== null && {
          sort: row.provider_sort,
        }),
        ...(providerOnlyValue !== undefined && {
          providerOnly: providerOnlyValue,
        }),
        ...(row.allow_fallbacks !== null && {
          allowFallbacks: Boolean(row.allow_fallbacks),
        }),
        ...(row.cloudflare_version !== null && {
          cloudflareVersion: row.cloudflare_version,
        }),
        ...(row.cost_quality_tradeoff !== null && {
          costQualityTradeoff: row.cost_quality_tradeoff,
        }),
        ...(pinModel !== undefined && { pinModel }),
      },
      execution: {
        epochs: row.epochs,
        concurrency: row.concurrency,
        unordered: Boolean(row.unordered),
        ...(row.row_limit !== null && { limit: row.row_limit }),
        ...(row.range_start !== null && { start: row.range_start }),
        ...(row.range_end !== null && { end: row.range_end }),
        ...(row.max_retries !== null && { maxRetries: row.max_retries }),
      },
      ...(row.log_level !== null && { logLevel: row.log_level }),
    },
    startedAt: isoDate(row.started_at)!,
    finishedAt: isoDate(row.finished_at),
    exitCode: optional(row.exit_code) ?? null,
    failureReason: row.failure_reason,
    expectedQuestions: row.expected_questions,
    completedQuestions: row.completed_questions,
    skippedQuestions: row.skipped_questions,
    completionPercentage: row.completion_percentage,
    totalEvaluations: row.total_evaluations,
    completedEvaluations: row.completed_evaluations,
    skippedEvaluations: row.skipped_evaluations,
    qualityScore: row.quality_score,
    cancelRequestedAt: isoDate(row.cancel_requested_at),
    uploadStatus: row.upload_status,
    uploadError: row.upload_error,
    uploadedAt: isoDate(row.uploaded_at),
    spacesBucket: row.spaces_bucket,
    spacesPrefix: row.spaces_prefix,
    manifestKey: row.manifest_key,
    triggeredByEmail: row.triggered_by_email,
  };
}

function recordValues(record: RunRecord): readonly MysqlValue[] {
  const { execution, inference } = record.args;
  return [
    record.id,
    record.args.benchmark,
    record.args.runKind ?? "benchmark",
    record.args.sourceRunId ?? null,
    record.args.campaignId ?? null,
    record.args.campaignArm ?? null,
    record.args.sampleIds === undefined
      ? null
      : JSON.stringify(record.args.sampleIds),
    inference.model,
    record.args.judgeModel ?? null,
    inference.baseUrl,
    record.status,
    record.disabled,
    new Date(record.startedAt),
    dateValue(record.finishedAt),
    dateValue(record.cancelRequestedAt),
    record.exitCode,
    record.failureReason,
    record.expectedQuestions,
    record.completedQuestions,
    record.skippedQuestions,
    record.completionPercentage,
    record.totalEvaluations,
    record.completedEvaluations,
    record.skippedEvaluations,
    record.qualityScore,
    execution.epochs,
    execution.concurrency,
    execution.unordered ?? false,
    execution.limit ?? null,
    execution.start ?? null,
    execution.end ?? null,
    execution.maxRetries ?? null,
    inference.temperature,
    inference.maxTokens ?? null,
    inference.reasoningEffort ?? null,
    inference.timeoutMs ?? null,
    inference.completionTimeoutMs ?? null,
    inference.endpointId ?? null,
    inference.costTier ?? null,
    inference.sort ?? null,
    inference.providerOnly === undefined
      ? null
      : JSON.stringify(inference.providerOnly),
    inference.allowFallbacks ?? null,
    inference.cloudflareVersion ?? null,
    inference.costQualityTradeoff ?? null,
    inference.pinModel ?? null,
    record.args.logLevel ?? null,
    record.uploadStatus,
    record.uploadError,
    dateValue(record.uploadedAt),
    record.spacesBucket,
    record.spacesPrefix,
    record.manifestKey,
    record.args.triggeredByEmail ?? null,
    JSON.stringify(record.args),
  ];
}

async function retry<T>(
  operation: string,
  run: () => Promise<T>,
  attempts: number,
  delayMs: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) {
        await Bun.sleep(delayMs * attempt);
      }
    }
  }
  throw new RunMetadataStoreError(
    `MySQL ${operation} failed after ${attempts} attempts`,
    { cause: lastError }
  );
}

export function makeRunMetadataStore(
  executor: MysqlExecutor,
  options: {
    readonly attempts?: number;
    readonly delayMs?: number;
  } = {}
): RunMetadataStore {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 100;
  return {
    upsert: (record) =>
      retry(
        `upsert for run ${record.id}`,
        () => executor.execute(UPSERT_SQL, recordValues(record)),
        attempts,
        delayMs
      ),
    setDisabled: (id, disabled) =>
      retry(
        `set disabled for run ${id}`,
        () =>
          executor.execute(
            "UPDATE benchmark_runs SET disabled = ? WHERE id = ?",
            [disabled, id]
          ),
        attempts,
        delayMs
      ),
    get: async (id) => {
      const rows = await retry(
        `get for run ${id}`,
        () =>
          executor.query<RunMetadataRow>(
            `SELECT ${COLUMNS} FROM benchmark_runs WHERE id = ?`,
            [id]
          ),
        attempts,
        delayMs
      );
      const row = rows[0];
      return row === undefined ? undefined : rowToMetadata(row);
    },
    list: async () => {
      const rows = await retry(
        "list",
        () =>
          executor.query<RunMetadataRow>(
            `SELECT ${COLUMNS} FROM benchmark_runs ORDER BY started_at DESC`
          ),
        attempts,
        delayMs
      );
      return rows.map(rowToMetadata);
    },
  };
}
