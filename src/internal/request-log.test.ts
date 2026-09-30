import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  logModelRequestCompleted,
  logModelRequestProgress,
  logModelRequestStarted,
} from "./request-log";

let root: string | undefined;
const originalPath = process.env["REQUEST_LOG_FILE"];

afterEach(async () => {
  if (originalPath === undefined) {
    Reflect.deleteProperty(process.env, "REQUEST_LOG_FILE");
  } else {
    process.env["REQUEST_LOG_FILE"] = originalPath;
  }
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

async function records(path: string): Promise<Record<string, unknown>[]> {
  const content = await readFile(path, "utf8");
  return content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("model request event logging", () => {
  it("persists initiation before completion and keeps successful records compact", async () => {
    root = await mkdtemp(join(tmpdir(), "request-events-"));
    const path = join(root, "requests", "requests.jsonl");
    process.env["REQUEST_LOG_FILE"] = path;

    logModelRequestStarted({
      requestId: "request-1",
      sessionId: "run-1",
      attempt: 1,
      startedAt: "2026-08-14T10:00:00.000Z",
      model: "model-1",
      url: "https://inference.example.com/v1/chat/completions",
      request: { messages: 1, stream: true },
    });

    expect(await records(path)).toEqual([
      expect.objectContaining({
        event: "started",
        request_id: "request-1",
        started_at: "2026-08-14T10:00:00.000Z",
      }),
    ]);

    logModelRequestCompleted({
      requestId: "request-1",
      sessionId: "run-1",
      attempt: 1,
      startedAt: "2026-08-14T10:00:00.000Z",
      finishedAt: "2026-08-14T10:00:01.000Z",
      durationMs: 1000,
      model: "model-1",
      url: "https://inference.example.com/v1/chat/completions",
      ok: true,
      status: 200,
      providerName: "DigitalOcean",
      response: "successful response must not be stored",
    });

    const logged = await records(path);
    expect(logged).toHaveLength(2);
    expect(logged[1]).toMatchObject({
      event: "completed",
      request_id: "request-1",
      status: 200,
      duration_ms: 1000,
      ok: true,
      provider_name: "DigitalOcean",
    });
    expect(logged[1]).not.toHaveProperty("response");
  });

  it("keeps failed response details", async () => {
    root = await mkdtemp(join(tmpdir(), "request-events-"));
    const path = join(root, "requests.jsonl");
    process.env["REQUEST_LOG_FILE"] = path;

    logModelRequestCompleted({
      requestId: "request-2",
      attempt: 2,
      startedAt: "2026-08-14T10:00:00.000Z",
      finishedAt: "2026-08-14T10:00:02.000Z",
      durationMs: 2000,
      model: "model-1",
      url: "https://inference.example.com/v1/chat/completions",
      ok: false,
      status: 503,
      response: '{"error":"unavailable"}',
      error: "HTTP 503",
      failureStage: "http",
    });

    const logged = await records(path);
    expect(logged[0]).toMatchObject({
      status: 503,
      error: "HTTP 503",
      response: '{"error":"unavailable"}',
      failure_stage: "http",
    });
  });

  it("persists request bodies and incremental response reasoning", async () => {
    root = await mkdtemp(join(tmpdir(), "request-events-"));
    const path = join(root, "requests.jsonl");
    process.env["REQUEST_LOG_FILE"] = path;

    logModelRequestStarted({
      requestId: "request-live",
      attempt: 1,
      startedAt: "2026-09-01T08:00:00.000Z",
      model: "model-1",
      url: "https://openrouter.ai/api/v1/chat/completions",
      request: { messages: 1, stream: true },
      requestBody: {
        model: "model-1",
        messages: [{ role: "user", content: "Question" }],
        stream: true,
      },
    });
    logModelRequestProgress({
      requestId: "request-live",
      attempt: 1,
      startedAt: "2026-09-01T08:00:00.000Z",
      observedAt: "2026-09-01T08:00:01.000Z",
      elapsedMs: 1000,
      model: "model-1",
      url: "https://openrouter.ai/api/v1/chat/completions",
      status: 200,
      receivedBytes: 123,
      timeToFirstOutputMs: 750,
      reasoningDelta: "Reasoning ",
      contentDelta: "Answer",
    });

    expect(await records(path)).toEqual([
      expect.objectContaining({
        event: "started",
        request_body: expect.objectContaining({ model: "model-1" }),
      }),
      expect.objectContaining({
        event: "progress",
        received_bytes: 123,
        time_to_first_output_ms: 750,
        reasoning_delta: "Reasoning ",
        content_delta: "Answer",
      }),
    ]);
  });
});
