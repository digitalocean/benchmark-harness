import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MysqlExecutor, MysqlValue } from "./mysql";
import { applyMysqlMigrations, mysqlConfigFromEnv } from "./mysql";

const BASE_ENV: NodeJS.ProcessEnv = {
  MYSQL_HOST: "db.example.com",
  MYSQL_USER: "doadmin",
  MYSQL_PASSWORD: "password",
  MYSQL_DATABASE: "defaultdb",
};

describe("mysqlConfigFromEnv", () => {
  it("uses DigitalOcean-compatible defaults", () => {
    expect(mysqlConfigFromEnv(BASE_ENV)).toEqual({
      host: "db.example.com",
      port: 25_060,
      user: "doadmin",
      password: "password",
      database: "defaultdb",
      sslMode: "required",
      connectionLimit: 10,
    });
  });

  it("requires credentials and validates numeric settings", () => {
    expect(() =>
      mysqlConfigFromEnv({ ...BASE_ENV, MYSQL_PASSWORD: "" })
    ).toThrow("Missing MySQL environment variables: MYSQL_PASSWORD");
    expect(() =>
      mysqlConfigFromEnv({ ...BASE_ENV, MYSQL_PORT: "invalid" })
    ).toThrow("Expected a positive integer");
  });

  it("requires a CA path for certificate verification", () => {
    expect(() =>
      mysqlConfigFromEnv({ ...BASE_ENV, MYSQL_SSL_MODE: "verify-ca" })
    ).toThrow("MYSQL_CA_CERT_PATH is required when MYSQL_SSL_MODE=verify-ca");
    expect(
      mysqlConfigFromEnv({
        ...BASE_ENV,
        MYSQL_SSL_MODE: "verify-ca",
        MYSQL_CA_CERT_PATH: "/tmp/ca.pem",
      }).caCertPath
    ).toBe("/tmp/ca.pem");
  });
});

describe("applyMysqlMigrations", () => {
  it("runs only pending SQL files in filename order", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mysql-migrations-"));
    try {
      writeFileSync(join(directory, "001_first.sql"), "SELECT 1");
      writeFileSync(join(directory, "002_second.sql"), "SELECT 2");
      const executions: {
        readonly sql: string;
        readonly values: readonly MysqlValue[];
      }[] = [];
      const executor: MysqlExecutor = {
        execute: (sql, values = []) => {
          executions.push({ sql: sql.trim(), values });
          return Promise.resolve();
        },
        query: <Row extends object>() =>
          Promise.resolve([{ version: "001_first.sql" }] as Row[]),
        close: () => Promise.resolve(),
      };

      await applyMysqlMigrations(executor, directory);

      expect(executions.some(({ sql }) => sql === "SELECT 1")).toBe(false);
      expect(executions.some(({ sql }) => sql === "SELECT 2")).toBe(true);
      expect(
        executions.some(({ values }) => values.includes("002_second.sql"))
      ).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
