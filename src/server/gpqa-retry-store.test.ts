import { describe, expect, it } from "bun:test";

import type { MysqlExecutor, MysqlValue } from "../internal/mysql";
import { makeGpqaRetryCampaignStore } from "./gpqa-retry-store";
import type { GpqaRetryCampaign } from "./gpqa-retry-store";

function campaign(): GpqaRetryCampaign {
  return {
    id: "campaign-id",
    sourceRunId: "source-id",
    status: "running",
    selectedFailureCounts: [3, 2],
    sampleIds: ["gpqa_diamond-1", "gpqa_diamond-2"],
    sourceEpochs: 3,
    originalRunId: "original-id",
    comparisonRunId: "comparison-id",
    originalConfig: {
      benchmark: "gpqa_diamond",
      runKind: "gpqa_retry_arm",
      sourceRunId: "source-id",
      campaignId: "campaign-id",
      campaignArm: "original",
      sampleIds: ["gpqa_diamond-1", "gpqa_diamond-2"],
      inference: {
        baseUrl: "https://example.com/v1",
        model: "model-a",
        temperature: 1,
      },
      execution: { epochs: 3, concurrency: 2 },
    },
    comparisonConfig: {
      benchmark: "gpqa_diamond",
      runKind: "gpqa_retry_arm",
      sourceRunId: "source-id",
      campaignId: "campaign-id",
      campaignArm: "comparison",
      sampleIds: ["gpqa_diamond-1", "gpqa_diamond-2"],
      inference: {
        baseUrl: "https://other.example.com/v1",
        model: "model-b",
        temperature: 1,
      },
      execution: { epochs: 5, concurrency: 3 },
    },
    triggeredByEmail: "person@digitalocean.com",
    startedAt: "2026-09-01T00:00:00.000Z",
    finishedAt: null,
    failureReason: null,
    uploadStatus: "pending",
    uploadError: null,
    uploadedAt: null,
    spacesBucket: null,
    spacesPrefix: null,
    manifestKey: null,
  };
}

describe("GPQA retry campaign store", () => {
  it("persists sanitized campaign linkage and configurations", async () => {
    let values: readonly MysqlValue[] = [];
    const executor: MysqlExecutor = {
      execute: (_sql, input = []) => {
        values = input;
        return Promise.resolve();
      },
      query: () => Promise.resolve([]),
      close: () => Promise.resolve(),
    };

    await makeGpqaRetryCampaignStore(executor).upsert(campaign());

    expect(values).toHaveLength(20);
    const serialized = JSON.stringify(values);
    expect(serialized).toContain("gpqa_diamond-1");
    expect(serialized).toContain("model-b");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("secret");
  });
});
