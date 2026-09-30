import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createPool } from "mysql2/promise";
import type { Pool, PoolOptions, RowDataPacket } from "mysql2/promise";

import { unknownErrorToString } from "./errors";

export type MysqlSslMode = "disabled" | "required" | "verify-ca";

export interface MysqlConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly sslMode: MysqlSslMode;
  readonly caCertPath?: string | undefined;
  readonly connectionLimit: number;
}

const REQUIRED_ENV = [
  "MYSQL_HOST",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
] as const;

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer, received ${raw}`);
  }
  return value;
}

export function mysqlConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): MysqlConfig {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing MySQL environment variables: ${missing.join(", ")}`
    );
  }
  const rawSslMode = env["MYSQL_SSL_MODE"] ?? "required";
  if (!["disabled", "required", "verify-ca"].includes(rawSslMode)) {
    throw new Error(
      "MYSQL_SSL_MODE must be one of disabled, required, or verify-ca"
    );
  }
  const sslMode = rawSslMode as MysqlSslMode;
  const caCertPath = env["MYSQL_CA_CERT_PATH"]?.trim();
  if (sslMode === "verify-ca" && !caCertPath) {
    throw new Error(
      "MYSQL_CA_CERT_PATH is required when MYSQL_SSL_MODE=verify-ca"
    );
  }
  return {
    host: env["MYSQL_HOST"]!,
    port: positiveInteger(env["MYSQL_PORT"], 25_060),
    user: env["MYSQL_USER"]!,
    password: env["MYSQL_PASSWORD"]!,
    database: env["MYSQL_DATABASE"]!,
    sslMode,
    ...(caCertPath && { caCertPath }),
    connectionLimit: positiveInteger(env["MYSQL_CONNECTION_LIMIT"], 10),
  };
}

function poolOptions(config: MysqlConfig): PoolOptions {
  const ssl =
    config.sslMode === "disabled"
      ? undefined
      : {
          rejectUnauthorized: config.sslMode === "verify-ca",
          ...(config.caCertPath && {
            ca: readFileSync(config.caCertPath, "utf8"),
          }),
        };
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    waitForConnections: true,
    enableKeepAlive: true,
    timezone: "Z",
    ...(ssl && { ssl }),
  };
}

export type MysqlValue = string | number | boolean | Date | Buffer | null;

export interface MysqlExecutor {
  readonly execute: (
    sql: string,
    values?: readonly MysqlValue[]
  ) => Promise<void>;
  readonly query: <Row extends object>(
    sql: string,
    values?: readonly MysqlValue[]
  ) => Promise<readonly Row[]>;
  readonly close: () => Promise<void>;
}

function executorFromPool(pool: Pool): MysqlExecutor {
  return {
    execute: async (sql, values = []) => {
      await pool.execute(sql, [...values]);
    },
    query: async <Row extends object>(
      sql: string,
      values: readonly MysqlValue[] = []
    ) => {
      const [rows] = await pool.execute<RowDataPacket[]>(sql, [...values]);
      return rows as Row[];
    },
    close: async () => {
      await pool.end();
    },
  };
}

export async function applyMysqlMigrations(
  executor: MysqlExecutor,
  migrationDirectory: string
): Promise<void> {
  await executor.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const applied = await executor.query<{ readonly version: string }>(
    "SELECT version FROM schema_migrations"
  );
  const appliedVersions = new Set(applied.map(({ version }) => version));
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    if (appliedVersions.has(migration)) {
      continue;
    }
    await executor.execute(
      readFileSync(join(migrationDirectory, migration), "utf8")
    );
    await executor.execute(
      "INSERT INTO schema_migrations (version) VALUES (?)",
      [migration]
    );
  }
}

export async function initializeMysql(
  config: MysqlConfig = mysqlConfigFromEnv(),
  migrationDirectory = join(process.cwd(), "deploy/mysql")
): Promise<MysqlExecutor> {
  const pool = createPool(poolOptions(config));
  try {
    const connection = await pool.getConnection();
    try {
      await connection.ping();
    } finally {
      connection.release();
    }
    const executor = executorFromPool(pool);
    await applyMysqlMigrations(executor, migrationDirectory);
    return executor;
  } catch (error) {
    await pool.end();
    throw new Error(
      `MySQL initialization failed: ${unknownErrorToString(error)}`,
      { cause: error }
    );
  }
}
