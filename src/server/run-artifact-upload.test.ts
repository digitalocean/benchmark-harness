import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SpacesClient, SpacesConfig } from "../internal/spaces";
import { uploadRunBundle } from "./run-artifact-upload";

const CONFIG: SpacesConfig = {
  endpoint: "https://nyc3.digitaloceanspaces.com",
  region: "nyc3",
  bucket: "private-benchmarks",
  accessKeyId: "access",
  secretAccessKey: "secret",
  prefix: "bench-runs",
  forcePathStyle: false,
};

describe("run artifact upload", () => {
  it("uploads the complete run tree and writes the manifest last", async () => {
    const root = await mkdtemp(join(tmpdir(), "bench-upload-"));
    const uploaded: {
      key: string;
      content: string;
      contentType: string;
    }[] = [];
    const client: SpacesClient = {
      putFile: async ({ contentType, key, path }) => {
        uploaded.push({
          key,
          content: await readFile(path, "utf8"),
          contentType,
        });
      },
    };
    try {
      await mkdir(join(root, "logs"));
      await mkdir(join(root, "requests"));
      await mkdir(join(root, "results"));
      await writeFile(join(root, "run.json"), '{"status":"succeeded"}');
      await writeFile(join(root, "logs", "run.log"), "complete log");
      await writeFile(
        join(root, "requests", "requests.jsonl"),
        '{"status":200}\n'
      );
      await writeFile(join(root, "results", "result.parquet"), "parquet");

      const result = await uploadRunBundle(
        {
          id: "run-123",
          benchmark: "gpqa_diamond",
          root,
          startedAt: "2026-08-14T10:00:00.000Z",
          finishedAt: "2026-08-14T10:05:00.000Z",
          status: "succeeded",
          exitCode: 0,
          failureReason: null,
        },
        { config: CONFIG, client }
      );

      expect(result.prefix).toBe("bench-runs/gpqa/2026/08/14/run-123");
      expect(uploaded.map(({ key }) => key)).toEqual([
        `${result.prefix}/logs/run.log`,
        `${result.prefix}/requests/requests.jsonl`,
        `${result.prefix}/results/result.parquet`,
        `${result.prefix}/run.json`,
        `${result.prefix}/manifest.json`,
      ]);
      const manifest = JSON.parse(uploaded.at(-1)?.content ?? "{}");
      expect(manifest.runId).toBe("run-123");
      expect(manifest.benchmark).toBe("gpqa_diamond");
      expect(manifest.failureReason).toBeNull();
      expect(manifest.files).toHaveLength(4);
      expect(uploaded.at(-1)?.contentType).toBe("application/json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
