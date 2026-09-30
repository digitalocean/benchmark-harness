import { Either } from "../internal/either";
import type { MysqlExecutor, MysqlValue } from "../internal/mysql";
import { firstZodIssueMessage, parseSchema, z } from "../internal/zod";
import type { RunArgs, UploadStatus } from "./run-registry";

export type GpqaRetryCampaignStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface GpqaRetryCampaign {
  readonly id: string;
  readonly sourceRunId: string;
  status: GpqaRetryCampaignStatus;
  readonly selectedFailureCounts: readonly number[];
  readonly sampleIds: readonly string[];
  readonly sourceEpochs: number;
  originalRunId: string | null;
  comparisonRunId: string | null;
  readonly originalConfig: RunArgs;
  readonly comparisonConfig: RunArgs | null;
  readonly triggeredByEmail: string;
  readonly startedAt: string;
  finishedAt: string | null;
  failureReason: string | null;
  uploadStatus: UploadStatus;
  uploadError: string | null;
  uploadedAt: string | null;
  spacesBucket: string | null;
  spacesPrefix: string | null;
  manifestKey: string | null;
}

export interface GpqaRetryCampaignStore {
  readonly upsert: (campaign: GpqaRetryCampaign) => Promise<void>;
  readonly get: (id: string) => Promise<GpqaRetryCampaign | undefined>;
  readonly listBySourceRun: (
    sourceRunId: string
  ) => Promise<readonly GpqaRetryCampaign[]>;
  readonly listUnfinished: () => Promise<readonly GpqaRetryCampaign[]>;
}

export class GpqaRetryCampaignStoreError extends Error {
  override readonly name = "GpqaRetryCampaignStoreError";
}

const DateValueSchema = z.union([z.date(), z.string()]);
const NullableDateValueSchema = DateValueSchema.nullable();
const NullableStringSchema = z.string().nullable();

const CampaignRowSchema = z.object({
  id: z.string().min(1),
  source_run_id: z.string().min(1),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  selected_failure_counts_json: z.unknown(),
  sample_ids_json: z.unknown(),
  source_epochs: z.coerce.number().int().positive(),
  original_run_id: NullableStringSchema,
  comparison_run_id: NullableStringSchema,
  original_config_json: z.unknown(),
  comparison_config_json: z.unknown().nullable(),
  triggered_by_email: z.string().email(),
  started_at: DateValueSchema,
  finished_at: NullableDateValueSchema,
  failure_reason: NullableStringSchema,
  upload_status: z.enum(["pending", "uploading", "complete", "failed"]),
  upload_error: NullableStringSchema,
  uploaded_at: NullableDateValueSchema,
  spaces_bucket: NullableStringSchema,
  spaces_prefix: NullableStringSchema,
  manifest_key: NullableStringSchema,
});

const RunArgsSchema = z.object({
  benchmark: z.literal("gpqa_diamond"),
  triggeredByEmail: z.string().optional(),
  runKind: z.literal("gpqa_retry_arm"),
  sourceRunId: z.string(),
  campaignId: z.string(),
  campaignArm: z.enum(["original", "comparison"]),
  sampleIds: z.array(z.string().min(1)).min(1),
  inference: z.object({
    baseUrl: z.url(),
    model: z.string().min(1),
    temperature: z.number(),
    maxTokens: z.number().optional(),
    reasoningEffort: z
      .enum(["xhigh", "high", "medium", "low", "minimal", "none"])
      .optional(),
    timeoutMs: z.number().optional(),
    completionTimeoutMs: z.number().optional(),
    endpointId: z.string().optional(),
    costTier: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    sort: z.enum(["price", "throughput", "latency", "exacto"]).optional(),
    providerOnly: z.array(z.string()).optional(),
    allowFallbacks: z.boolean().optional(),
    cloudflareVersion: z.string().optional(),
    costQualityTradeoff: z.number().optional(),
    pinModel: z.boolean().optional(),
  }),
  execution: z.object({
    epochs: z.number().int().positive(),
    concurrency: z.number().int().positive(),
    unordered: z.boolean().optional(),
    maxRetries: z.number().int().nonnegative().optional(),
  }),
  logLevel: z.string().optional(),
});

type CampaignRow = z.infer<typeof CampaignRowSchema>;

const COLUMNS = `
  id, source_run_id, status, selected_failure_counts_json, sample_ids_json,
  source_epochs, original_run_id, comparison_run_id, original_config_json,
  comparison_config_json, triggered_by_email, started_at, finished_at,
  failure_reason, upload_status, upload_error, uploaded_at, spaces_bucket,
  spaces_prefix, manifest_key
`;

const UPSERT_SQL = `
INSERT INTO gpqa_retry_campaigns (${COLUMNS})
VALUES (${Array.from({ length: 20 }, () => "?").join(", ")})
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  original_run_id = VALUES(original_run_id),
  comparison_run_id = VALUES(comparison_run_id),
  finished_at = VALUES(finished_at),
  failure_reason = VALUES(failure_reason),
  upload_status = VALUES(upload_status),
  upload_error = VALUES(upload_error),
  uploaded_at = VALUES(uploaded_at),
  spaces_bucket = VALUES(spaces_bucket),
  spaces_prefix = VALUES(spaces_prefix),
  manifest_key = VALUES(manifest_key)
`;

function isoDate(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  const date =
    value instanceof Date
      ? value
      : new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) {
    throw new GpqaRetryCampaignStoreError(`Invalid MySQL date: ${value}`);
  }
  return date.toISOString();
}

function dateValue(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function decodeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const decoded = Either.try((): unknown => JSON.parse(value));
  if (Either.isLeft(decoded)) {
    throw new GpqaRetryCampaignStoreError("Invalid campaign JSON in MySQL");
  }
  return decoded.right;
}

function decodeWith<T>(schema: z.ZodType<T>, value: unknown, name: string): T {
  const parsed = parseSchema(schema, decodeJson(value));
  if (Either.isLeft(parsed)) {
    throw new GpqaRetryCampaignStoreError(
      `Invalid ${name}: ${firstZodIssueMessage(parsed.left)}`
    );
  }
  return parsed.right;
}

function rowToCampaign(input: unknown): GpqaRetryCampaign {
  const parsed = parseSchema(CampaignRowSchema, input);
  if (Either.isLeft(parsed)) {
    throw new GpqaRetryCampaignStoreError(
      `Invalid gpqa_retry_campaigns row: ${firstZodIssueMessage(parsed.left)}`
    );
  }
  const row: CampaignRow = parsed.right;
  return {
    id: row.id,
    sourceRunId: row.source_run_id,
    status: row.status,
    selectedFailureCounts: decodeWith(
      z.array(z.number().int().positive()).min(1),
      row.selected_failure_counts_json,
      "selected failure counts"
    ),
    sampleIds: decodeWith(
      z.array(z.string().min(1)).min(1),
      row.sample_ids_json,
      "sample ids"
    ),
    sourceEpochs: row.source_epochs,
    originalRunId: row.original_run_id,
    comparisonRunId: row.comparison_run_id,
    originalConfig: decodeWith(
      RunArgsSchema,
      row.original_config_json,
      "original config"
    ),
    comparisonConfig:
      row.comparison_config_json === null
        ? null
        : decodeWith(
            RunArgsSchema,
            row.comparison_config_json,
            "comparison config"
          ),
    triggeredByEmail: row.triggered_by_email,
    startedAt: isoDate(row.started_at)!,
    finishedAt: isoDate(row.finished_at),
    failureReason: row.failure_reason,
    uploadStatus: row.upload_status,
    uploadError: row.upload_error,
    uploadedAt: isoDate(row.uploaded_at),
    spacesBucket: row.spaces_bucket,
    spacesPrefix: row.spaces_prefix,
    manifestKey: row.manifest_key,
  };
}

function campaignValues(campaign: GpqaRetryCampaign): readonly MysqlValue[] {
  return [
    campaign.id,
    campaign.sourceRunId,
    campaign.status,
    JSON.stringify(campaign.selectedFailureCounts),
    JSON.stringify(campaign.sampleIds),
    campaign.sourceEpochs,
    campaign.originalRunId,
    campaign.comparisonRunId,
    JSON.stringify(campaign.originalConfig),
    campaign.comparisonConfig === null
      ? null
      : JSON.stringify(campaign.comparisonConfig),
    campaign.triggeredByEmail,
    new Date(campaign.startedAt),
    dateValue(campaign.finishedAt),
    campaign.failureReason,
    campaign.uploadStatus,
    campaign.uploadError,
    dateValue(campaign.uploadedAt),
    campaign.spacesBucket,
    campaign.spacesPrefix,
    campaign.manifestKey,
  ];
}

export function makeGpqaRetryCampaignStore(
  executor: MysqlExecutor
): GpqaRetryCampaignStore {
  return {
    upsert: async (campaign) => {
      try {
        await executor.execute(UPSERT_SQL, campaignValues(campaign));
      } catch (error) {
        throw new GpqaRetryCampaignStoreError(
          "MySQL GPQA retry campaign write failed",
          { cause: error }
        );
      }
    },
    get: async (id) => {
      try {
        const rows = await executor.query<Record<string, unknown>>(
          `SELECT ${COLUMNS} FROM gpqa_retry_campaigns WHERE id = ?`,
          [id]
        );
        const row = rows[0];
        return row === undefined ? undefined : rowToCampaign(row);
      } catch (error) {
        if (error instanceof GpqaRetryCampaignStoreError) {
          throw error;
        }
        throw new GpqaRetryCampaignStoreError(
          "MySQL GPQA retry campaign read failed",
          { cause: error }
        );
      }
    },
    listBySourceRun: async (sourceRunId) => {
      try {
        const rows = await executor.query<Record<string, unknown>>(
          `SELECT ${COLUMNS} FROM gpqa_retry_campaigns
           WHERE source_run_id = ? ORDER BY started_at DESC`,
          [sourceRunId]
        );
        return rows.map(rowToCampaign);
      } catch (error) {
        throw new GpqaRetryCampaignStoreError(
          "MySQL GPQA retry campaign list failed",
          { cause: error }
        );
      }
    },
    listUnfinished: async () => {
      try {
        const rows = await executor.query<Record<string, unknown>>(
          `SELECT ${COLUMNS} FROM gpqa_retry_campaigns
           WHERE status = 'running' OR upload_status IN ('pending', 'uploading')`
        );
        return rows.map(rowToCampaign);
      } catch (error) {
        throw new GpqaRetryCampaignStoreError(
          "MySQL unfinished GPQA retry campaign list failed",
          { cause: error }
        );
      }
    },
  };
}
