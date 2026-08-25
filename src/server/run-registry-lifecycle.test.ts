import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunMetadata, RunMetadataStore } from "./run-metadata-store";
import {
  activeRunCount,
  cancelRun,
  configureRunMetadataStore,
  loadPersistedRuns,
  refreshLiveProgress,
  startRun,
} from "./run-registry";
import type { RunArgs, RunRecord } from "./run-registry";

const originalCwd = process.cwd();
let temporaryDirectory: string | undefined;

afterEach(() => {
  process.chdir(originalCwd);
  if (temporaryDirectory !== undefined) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

function args(): RunArgs {
  return {
    benchmark: "gpqa_diamond",
    inference: {
      baseUrl: "https://inference.example.com/v1",
      model: "provider/model",
      temperature: 0.5,
    },
    execution: {
      epochs: 1,
      concurrency: 1,
      limit: 1,
    },
  };
}

function store(upsert: (record: RunRecord) => Promise<void>): RunMetadataStore {
  return {
    upsert,
    setDisabled: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([] as RunMetadata[]),
  };
}

function makeTemporaryCwd(): string {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "benchmark-mysql-test-"));
  process.chdir(temporaryDirectory);
  return temporaryDirectory;
}

describe("mandatory MySQL run metadata", () => {
  it("does not spawn a benchmark when the initial metadata write fails", async () => {
    const root = makeTemporaryCwd();
    const activeBefore = activeRunCount();
    configureRunMetadataStore(
      store(() => Promise.reject(new Error("mysql unavailable")))
    );

    await expect(
      startRun(args(), {
        apiKey: "payload-secret",
        maxActiveRuns: activeBefore + 1,
      })
    ).rejects.toThrow("mysql unavailable");

    expect(activeRunCount()).toBe(activeBefore);
    const apiRoot = join(root, "logs/api");
    const runId = readdirSync(apiRoot)[0];
    expect(runId).toBeDefined();
    const persisted = JSON.parse(
      readFileSync(join(apiRoot, runId!, "run.json"), "utf8")
    ) as RunRecord;
    expect(persisted.status).toBe("failed");
    expect(persisted.pid).toBeNull();
    expect(JSON.stringify(persisted)).not.toContain("payload-secret");
  });

  it("reconciles terminal local records into MySQL on startup", async () => {
    const root = makeTemporaryCwd();
    const id = randomUUID();
    const directory = join(root, "logs/api", id);
    mkdirSync(directory, { recursive: true });
    const record: RunRecord = {
      id,
      status: "succeeded",
      args: args(),
      argv: [],
      pid: null,
      startedAt: "2026-08-14T10:00:00.000Z",
      finishedAt: "2026-08-14T10:01:00.000Z",
      exitCode: 0,
      expectedQuestions: 1,
      completedQuestions: 1,
      skippedQuestions: 0,
      completionPercentage: 100,
      totalEvaluations: 1,
      completedEvaluations: 1,
      skippedEvaluations: 0,
      qualityScore: 1,
      disabled: false,
      cancelRequestedAt: null,
      uploadStatus: "complete",
      uploadError: null,
      uploadedAt: "2026-08-14T10:02:00.000Z",
      spacesBucket: "bucket",
      spacesPrefix: "prefix",
      manifestKey: "prefix/manifest.json",
      root: directory,
      logPath: join(directory, "logs/run.log"),
      requestLogPath: join(directory, "requests/requests.jsonl"),
      resultsDir: join(directory, "results"),
    };
    mkdirSync(join(directory, "logs"));
    mkdirSync(join(directory, "requests"));
    mkdirSync(join(directory, "results"));
    writeFileSync(record.logPath, "uploaded log");
    writeFileSync(record.requestLogPath, '{"event":"completed"}\n');
    writeFileSync(
      join(record.resultsDir, "result.parquet"),
      "uploaded parquet"
    );
    writeFileSync(join(directory, "run.json"), JSON.stringify(record));
    const reconciled: RunRecord[] = [];
    configureRunMetadataStore(
      store((value) => {
        reconciled.push(value);
        return Promise.resolve();
      })
    );

    await loadPersistedRuns();

    expect(reconciled.map((value) => value.id)).toContain(id);
    expect(reconciled.at(-1)?.completedQuestions).toBe(1);
    expect(reconciled.at(-1)?.completedEvaluations).toBe(1);
    expect(reconciled.at(-1)?.qualityScore).toBe(1);
    expect(existsSync(record.logPath)).toBe(false);
    expect(existsSync(record.requestLogPath)).toBe(false);
    expect(existsSync(record.resultsDir)).toBe(false);
    expect(existsSync(join(directory, "run.json"))).toBe(true);
    writeFileSync(
      join(directory, "progress.json"),
      JSON.stringify({
        completed: 1,
        processed: 1,
        skipped: 0,
        total: 4,
        percentage: 25,
        updatedAt: "2026-08-14T10:00:30.000Z",
      })
    );
    await refreshLiveProgress(record);
    expect(record.completionPercentage).toBe(25);
    expect(record.completedEvaluations).toBe(1);
    expect(record.skippedEvaluations).toBe(0);
    expect(reconciled.at(-1)?.completionPercentage).toBe(25);
  });

  it("marks a running benchmark cancelled before returning", async () => {
    const root = makeTemporaryCwd();
    const id = randomUUID();
    const directory = join(root, "logs/api", id);
    mkdirSync(directory, { recursive: true });
    const child = Bun.spawn({
      cmd: [process.execPath, "-e", "await Bun.sleep(60000)"],
      stdout: "ignore",
      stderr: "ignore",
    });
    const record: RunRecord = {
      id,
      status: "running",
      args: args(),
      argv: [],
      pid: child.pid,
      startedAt: "2026-08-14T10:00:00.000Z",
      finishedAt: null,
      exitCode: null,
      expectedQuestions: 1,
      completedQuestions: 0,
      skippedQuestions: 0,
      completionPercentage: 0,
      totalEvaluations: 1,
      completedEvaluations: 0,
      skippedEvaluations: 0,
      qualityScore: null,
      disabled: false,
      cancelRequestedAt: null,
      uploadStatus: "pending",
      uploadError: null,
      uploadedAt: null,
      spacesBucket: null,
      spacesPrefix: null,
      manifestKey: null,
      root: directory,
      logPath: join(directory, "logs/run.log"),
      requestLogPath: join(directory, "requests/requests.jsonl"),
      resultsDir: join(directory, "results"),
    };
    writeFileSync(join(directory, "run.json"), JSON.stringify(record));
    const statuses: string[] = [];
    configureRunMetadataStore(
      store((value) => {
        statuses.push(value.status);
        return Promise.resolve();
      })
    );

    try {
      await loadPersistedRuns();
      const cancelled = await cancelRun(id);

      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.cancelRequestedAt).not.toBeNull();
      expect(statuses.at(-1)).toBe("cancelled");
      expect(activeRunCount()).toBe(0);
    } finally {
      if (child.exitCode === null) {
        child.kill();
      }
      await child.exited;
    }
  });
});
