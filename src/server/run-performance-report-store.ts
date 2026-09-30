import { Either } from "../internal/either";
import type { MysqlExecutor, MysqlValue } from "../internal/mysql";
import { firstZodIssueMessage, parseSchema, z } from "../internal/zod";
import { RunPerformanceReportPayloadSchema } from "./run-performance-report-schema";
import type { RunPerformanceReportPayload } from "./run-performance-report-schema";

export type RunPerformanceReportStatus = "complete" | "failed";

export interface StoredRunPerformanceReport {
  readonly runId: string;
  readonly schemaVersion: number;
  readonly computedAt: string;
  readonly status: RunPerformanceReportStatus;
  readonly error: string | null;
  readonly report: RunPerformanceReportPayload;
}

export interface RunPerformanceReportStore {
  readonly upsert: (record: StoredRunPerformanceReport) => Promise<void>;
  readonly get: (
    runId: string
  ) => Promise<StoredRunPerformanceReport | undefined>;
}

export class RunPerformanceReportStoreError extends Error {
  override readonly name = "RunPerformanceReportStoreError";
}

const DateValueSchema = z.union([z.date(), z.string()]);
const NullableStringSchema = z.string().nullable();

const RowSchema = z.object({
  run_id: z.string().min(1),
  schema_version: z.coerce.number().int().positive(),
  computed_at: DateValueSchema,
  status: z.enum(["complete", "failed"]),
  error: NullableStringSchema,
  report_json: z.unknown(),
});

type Row = z.infer<typeof RowSchema>;

const COLUMNS = `
  run_id, schema_version, computed_at, status, error, report_json
`;

const UPSERT_SQL = `
INSERT INTO benchmark_run_performance_reports (${COLUMNS})
VALUES (?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  schema_version = VALUES(schema_version),
  computed_at = VALUES(computed_at),
  status = VALUES(status),
  error = VALUES(error),
  report_json = VALUES(report_json)
`;

function isoDate(value: Date | string): string {
  const date =
    value instanceof Date
      ? value
      : new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) {
    throw new RunPerformanceReportStoreError(
      `Invalid MySQL date value: ${value}`
    );
  }
  return date.toISOString();
}

function decodeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const decoded = Either.try((): unknown => JSON.parse(value));
  if (Either.isLeft(decoded)) {
    throw new RunPerformanceReportStoreError(
      "Invalid performance report JSON in MySQL"
    );
  }
  return decoded.right;
}

function rowToStored(input: unknown): StoredRunPerformanceReport {
  const parsed = parseSchema(RowSchema, input);
  if (Either.isLeft(parsed)) {
    throw new RunPerformanceReportStoreError(
      `Invalid benchmark_run_performance_reports row: ${firstZodIssueMessage(parsed.left)}`
    );
  }
  const row: Row = parsed.right;
  const reportParsed = parseSchema(
    RunPerformanceReportPayloadSchema,
    decodeJson(row.report_json)
  );
  if (Either.isLeft(reportParsed)) {
    throw new RunPerformanceReportStoreError(
      `Invalid performance report payload: ${firstZodIssueMessage(reportParsed.left)}`
    );
  }
  return {
    runId: row.run_id,
    schemaVersion: row.schema_version,
    computedAt: isoDate(row.computed_at),
    status: row.status,
    error: row.error,
    report: reportParsed.right,
  };
}

function values(record: StoredRunPerformanceReport): readonly MysqlValue[] {
  return [
    record.runId,
    record.schemaVersion,
    new Date(record.computedAt),
    record.status,
    record.error,
    JSON.stringify(record.report),
  ];
}

export function makeRunPerformanceReportStore(
  executor: MysqlExecutor
): RunPerformanceReportStore {
  return {
    upsert: async (record) => {
      try {
        await executor.execute(UPSERT_SQL, values(record));
      } catch (error) {
        throw new RunPerformanceReportStoreError(
          "MySQL run performance report write failed",
          { cause: error }
        );
      }
    },
    get: async (runId) => {
      try {
        const rows = await executor.query<Record<string, unknown>>(
          `SELECT ${COLUMNS} FROM benchmark_run_performance_reports WHERE run_id = ?`,
          [runId]
        );
        const row = rows[0];
        return row === undefined ? undefined : rowToStored(row);
      } catch (error) {
        if (error instanceof RunPerformanceReportStoreError) {
          throw error;
        }
        throw new RunPerformanceReportStoreError(
          "MySQL run performance report read failed",
          { cause: error }
        );
      }
    },
  };
}
