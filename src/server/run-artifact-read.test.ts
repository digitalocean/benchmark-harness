import { afterEach, describe, expect, it } from "bun:test";

import type { SpacesArtifactClient, SpacesGetResult } from "../internal/spaces";
import {
  configureRunArtifactClient,
  readRemoteRunParquet,
  remoteRunArtifactResponse,
  remoteRunLogTailResponse,
} from "./run-artifact-read";
import type { RunMetadata } from "./run-metadata-store";

const METADATA: RunMetadata = {
  id: "run-id",
  status: "succeeded",
  args: {
    benchmark: "gpqa_diamond",
    triggeredByEmail: "user@digitalocean.com",
    inference: {
      baseUrl: "https://inference.example.com/v1",
      model: "provider/model",
      temperature: 0.5,
    },
    execution: { epochs: 1, concurrency: 2 },
  },
  startedAt: "2026-08-14T10:00:00.000Z",
  finishedAt: "2026-08-14T10:05:00.000Z",
  exitCode: 0,
  expectedQuestions: 198,
  completedQuestions: 198,
  skippedQuestions: 0,
  completionPercentage: 100,
  totalEvaluations: 198,
  completedEvaluations: 198,
  skippedEvaluations: 0,
  qualityScore: 0.8,
  disabled: false,
  cancelRequestedAt: null,
  uploadStatus: "complete",
  uploadError: null,
  uploadedAt: "2026-08-14T10:06:00.000Z",
  spacesBucket: "bucket",
  spacesPrefix: "prefix/run-id",
  manifestKey: "prefix/run-id/manifest.json",
  triggeredByEmail: "user@digitalocean.com",
};

function object(content: string | Uint8Array): SpacesGetResult {
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  return {
    body: new Blob([bytes]).stream(),
    contentLength: bytes.length,
  };
}

function fakeClient(
  requested: { key: string; range?: string }[]
): SpacesArtifactClient {
  const files = new Map<string, string | Uint8Array>([
    ["prefix/run-id/logs/run.log", "first\nsecond\nthird"],
    ["prefix/run-id/requests/requests.jsonl", '{"event":"completed"}\n'],
    ["prefix/run-id/run.json", '{"status":"succeeded"}\n'],
    [
      "prefix/run-id/manifest.json",
      JSON.stringify({
        files: [
          {
            path: "results/result.parquet",
            bytes: 4,
            contentType: "application/vnd.apache.parquet",
          },
        ],
      }),
    ],
    ["prefix/run-id/results/result.parquet", new Uint8Array([80, 65, 82, 49])],
  ]);
  return {
    bucket: "bucket",
    getFile: ({ key, range }) => {
      requested.push({ key, ...(range !== undefined && { range }) });
      const content = files.get(key);
      return Promise.resolve(
        content === undefined ? undefined : object(content)
      );
    },
    putFile: () => Promise.resolve(),
    signedGetUrl: ({ key }) =>
      Promise.resolve(`https://bucket.example.com/${key}?signed=1`),
  };
}

afterEach(() => {
  configureRunArtifactClient(undefined);
});

describe("Spaces-backed run artifacts", () => {
  it("streams views from Spaces and bounds log tail reads", async () => {
    const requested: { key: string; range?: string }[] = [];
    configureRunArtifactClient(fakeClient(requested));

    const requests = await remoteRunArtifactResponse(
      METADATA,
      "requests",
      false
    );
    const logs = await remoteRunLogTailResponse(METADATA, 2);

    expect(await requests?.text()).toBe('{"event":"completed"}\n');
    expect(await logs?.text()).toBe("second\nthird");
    expect(requested.at(-1)).toEqual({
      key: "prefix/run-id/logs/run.log",
      range: "bytes=-8388608",
    });
  });

  it("returns a short-lived signed Spaces URL for direct downloads", async () => {
    configureRunArtifactClient(fakeClient([]));

    const response = await remoteRunArtifactResponse(METADATA, "state", true);

    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-artifact-download-url")).toBe(
      "https://bucket.example.com/prefix/run-id/run.json?signed=1"
    );
  });

  it("resolves and reads the Parquet object through the manifest", async () => {
    const requested: { key: string; range?: string }[] = [];
    configureRunArtifactClient(fakeClient(requested));

    const result = await readRemoteRunParquet(METADATA);

    expect(result?.file).toBe("result.parquet");
    expect(result?.bytes).toEqual(new Uint8Array([80, 65, 82, 49]));
    expect(requested.map(({ key }) => key)).toEqual([
      "prefix/run-id/manifest.json",
      "prefix/run-id/results/result.parquet",
    ]);
  });
});
