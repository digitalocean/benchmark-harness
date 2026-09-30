import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { GpqaReportItem } from "./gpqa-report";
import type { GpqaRetryCampaignReport } from "./gpqa-retry-report";
import type {
  GpqaRetryCampaign,
  GpqaRetryCampaignStore,
} from "./gpqa-retry-store";
import { uploadRunBundle } from "./run-artifact-upload";
import type { UploadDependencies } from "./run-artifact-upload";
import {
  activeRunCount,
  ActiveRunLimitError,
  cancelRun,
  getRunMetadata,
  startRun,
} from "./run-registry";
import type { RunArgs, RunInference } from "./run-registry";

export interface GpqaFailureBand {
  readonly failures: number;
  readonly epochs: number;
  readonly questionCount: number;
  readonly sampleIds: readonly string[];
}

export interface GpqaRetryArmInput {
  readonly apiKey: string;
  readonly inference?: RunInference | undefined;
  readonly repetitions: number;
  readonly concurrency?: number | undefined;
  readonly unordered?: boolean | undefined;
  readonly maxRetries?: number | undefined;
}

export interface GpqaRetryComparisonArmInput extends GpqaRetryArmInput {
  readonly inference: RunInference;
}

let campaignStore: GpqaRetryCampaignStore | undefined;

export function configureGpqaRetryCampaignStore(
  store: GpqaRetryCampaignStore
): void {
  campaignStore = store;
}

function requiredStore(): GpqaRetryCampaignStore {
  if (campaignStore === undefined) {
    throw new Error("GPQA retry campaign store is not configured");
  }
  return campaignStore;
}

export function gpqaFailureBands(
  items: readonly GpqaReportItem[],
  sourceEpochs: number
): readonly GpqaFailureBand[] {
  const failuresBySample = new Map<string, number>();
  for (const item of items) {
    const failures = failuresBySample.get(item.sampleId) ?? 0;
    failuresBySample.set(
      item.sampleId,
      failures + (item.status === "correct" ? 0 : 1)
    );
  }
  const sampleIdsByFailures = new Map<number, string[]>();
  for (const [sampleId, failures] of failuresBySample) {
    if (failures === 0) {
      continue;
    }
    const sampleIds = sampleIdsByFailures.get(failures) ?? [];
    sampleIds.push(sampleId);
    sampleIdsByFailures.set(failures, sampleIds);
  }
  return [...sampleIdsByFailures.entries()]
    .sort(([a], [b]) => b - a)
    .map(([failures, sampleIds]) => ({
      failures,
      epochs: sourceEpochs,
      questionCount: sampleIds.length,
      sampleIds: sampleIds.toSorted((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      ),
    }));
}

export function sampleIdsForFailureCounts(
  bands: readonly GpqaFailureBand[],
  selectedFailureCounts: readonly number[]
): readonly string[] {
  const selected = new Set(selectedFailureCounts);
  return bands
    .filter(({ failures }) => selected.has(failures))
    .flatMap(({ sampleIds }) => sampleIds)
    .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function gpqaRetryArmArgs(input: {
  readonly sourceRunId: string;
  readonly sourceArgs: RunArgs;
  readonly campaignId: string;
  readonly campaignArm: "original" | "comparison";
  readonly sampleIds: readonly string[];
  readonly arm: GpqaRetryArmInput;
  readonly inference: RunInference;
  readonly triggeredByEmail: string;
}): RunArgs {
  return {
    benchmark: "gpqa_diamond",
    runKind: "gpqa_retry_arm",
    sourceRunId: input.sourceRunId,
    campaignId: input.campaignId,
    campaignArm: input.campaignArm,
    sampleIds: input.sampleIds,
    triggeredByEmail: input.triggeredByEmail,
    inference: input.inference,
    execution: {
      epochs: input.arm.repetitions,
      concurrency:
        input.arm.concurrency ?? input.sourceArgs.execution.concurrency,
      unordered: input.arm.unordered ?? input.sourceArgs.execution.unordered,
      maxRetries: input.arm.maxRetries ?? input.sourceArgs.execution.maxRetries,
    },
    ...(input.sourceArgs.logLevel !== undefined && {
      logLevel: input.sourceArgs.logLevel,
    }),
  };
}

export async function startGpqaRetryCampaign(input: {
  readonly sourceRunId: string;
  readonly sourceArgs: RunArgs;
  readonly sourceItems: readonly GpqaReportItem[];
  readonly selectedFailureCounts: readonly number[];
  readonly original: GpqaRetryArmInput;
  readonly comparison?: GpqaRetryComparisonArmInput | undefined;
  readonly triggeredByEmail: string;
  readonly maxActiveRuns: number;
}): Promise<GpqaRetryCampaign> {
  const bands = gpqaFailureBands(
    input.sourceItems,
    input.sourceArgs.execution.epochs
  );
  const sampleIds = sampleIdsForFailureCounts(
    bands,
    input.selectedFailureCounts
  );
  if (sampleIds.length === 0) {
    throw new Error("Selected failure bands contain no GPQA questions");
  }
  const requiredSlots = input.comparison === undefined ? 1 : 2;
  if (activeRunCount() + requiredSlots > input.maxActiveRuns) {
    throw new ActiveRunLimitError(
      `Starting this campaign requires ${requiredSlots} active-run slots`
    );
  }
  const id = randomUUID();
  const originalConfig = gpqaRetryArmArgs({
    sourceRunId: input.sourceRunId,
    sourceArgs: input.sourceArgs,
    campaignId: id,
    campaignArm: "original",
    sampleIds,
    arm: input.original,
    inference: input.original.inference ?? input.sourceArgs.inference,
    triggeredByEmail: input.triggeredByEmail,
  });
  const comparisonConfig =
    input.comparison === undefined
      ? null
      : gpqaRetryArmArgs({
          sourceRunId: input.sourceRunId,
          sourceArgs: input.sourceArgs,
          campaignId: id,
          campaignArm: "comparison",
          sampleIds,
          arm: input.comparison,
          inference: input.comparison.inference,
          triggeredByEmail: input.triggeredByEmail,
        });
  const campaign: GpqaRetryCampaign = {
    id,
    sourceRunId: input.sourceRunId,
    status: "running",
    selectedFailureCounts: [...input.selectedFailureCounts].toSorted(
      (a, b) => b - a
    ),
    sampleIds,
    sourceEpochs: input.sourceArgs.execution.epochs,
    originalRunId: null,
    comparisonRunId: null,
    originalConfig,
    comparisonConfig,
    triggeredByEmail: input.triggeredByEmail,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    failureReason: null,
    uploadStatus: "pending",
    uploadError: null,
    uploadedAt: null,
    spacesBucket: null,
    spacesPrefix: null,
    manifestKey: null,
  };
  const store = requiredStore();
  await store.upsert(campaign);
  try {
    const originalRun = await startRun(originalConfig, {
      apiKey: input.original.apiKey,
      maxActiveRuns: input.maxActiveRuns,
    });
    campaign.originalRunId = originalRun.id;
    await store.upsert(campaign);
    if (input.comparison !== undefined && comparisonConfig !== null) {
      const comparisonRun = await startRun(comparisonConfig, {
        apiKey: input.comparison.apiKey,
        maxActiveRuns: input.maxActiveRuns,
      });
      campaign.comparisonRunId = comparisonRun.id;
      await store.upsert(campaign);
    }
    return campaign;
  } catch (error) {
    if (campaign.originalRunId !== null) {
      await cancelRun(campaign.originalRunId);
    }
    campaign.status = "failed";
    campaign.finishedAt = new Date().toISOString();
    campaign.failureReason = String(error);
    await store.upsert(campaign);
    throw error;
  }
}

export async function refreshGpqaRetryCampaign(
  campaign: GpqaRetryCampaign
): Promise<GpqaRetryCampaign> {
  const armIds = [campaign.originalRunId, campaign.comparisonRunId].filter(
    (id): id is string => id !== null
  );
  if (armIds.length === 0) {
    return campaign;
  }
  const arms = await Promise.all(armIds.map(getRunMetadata));
  if (arms.some((arm) => arm === undefined || arm.status === "running")) {
    return campaign;
  }
  const statuses = arms.map((arm) => arm?.status);
  if (statuses.includes("cancelled")) {
    campaign.status = "cancelled";
  } else if (statuses.every((status) => status === "succeeded")) {
    campaign.status = "succeeded";
  } else {
    campaign.status = "failed";
  }
  campaign.finishedAt ??= new Date().toISOString();
  campaign.failureReason =
    campaign.status === "failed"
      ? arms
          .flatMap((arm) => arm?.failureReason ?? [])
          .filter(Boolean)
          .join("\n") || "One or more retry arms failed"
      : null;
  await requiredStore().upsert(campaign);
  return campaign;
}

export async function getGpqaRetryCampaign(
  sourceRunId: string,
  campaignId: string
): Promise<GpqaRetryCampaign | undefined> {
  const campaign = await requiredStore().get(campaignId);
  return campaign?.sourceRunId === sourceRunId
    ? refreshGpqaRetryCampaign(campaign)
    : undefined;
}

export async function listGpqaRetryCampaigns(
  sourceRunId: string
): Promise<readonly GpqaRetryCampaign[]> {
  const campaigns = await requiredStore().listBySourceRun(sourceRunId);
  return Promise.all(campaigns.map(refreshGpqaRetryCampaign));
}

export async function cancelGpqaRetryCampaign(
  sourceRunId: string,
  campaignId: string
): Promise<GpqaRetryCampaign | undefined> {
  const campaign = await requiredStore().get(campaignId);
  if (campaign?.sourceRunId !== sourceRunId) {
    return undefined;
  }
  await Promise.all(
    [campaign.originalRunId, campaign.comparisonRunId]
      .filter((id): id is string => id !== null)
      .map(cancelRun)
  );
  campaign.status = "cancelled";
  campaign.finishedAt = new Date().toISOString();
  campaign.failureReason = null;
  await requiredStore().upsert(campaign);
  return campaign;
}

export async function reconcileGpqaRetryCampaigns(): Promise<void> {
  const campaigns = await requiredStore().listUnfinished();
  await Promise.all(campaigns.map(refreshGpqaRetryCampaign));
}

export function listPendingGpqaRetryCampaigns(): Promise<
  readonly GpqaRetryCampaign[]
> {
  return requiredStore().listUnfinished();
}

export async function archiveGpqaRetryCampaignReport(
  campaign: GpqaRetryCampaign,
  report: GpqaRetryCampaignReport,
  dependencies: UploadDependencies = {}
): Promise<GpqaRetryCampaign> {
  if (campaign.uploadStatus === "complete") {
    return campaign;
  }
  const root = join("logs", "gpqa-retry-comparisons", campaign.id);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "comparison.json"),
    JSON.stringify(campaign, null, 2)
  );
  writeFileSync(
    join(root, "comparison-report.json"),
    JSON.stringify(report, null, 2)
  );
  campaign.uploadStatus = "uploading";
  campaign.uploadError = null;
  await requiredStore().upsert(campaign);
  try {
    const uploaded = await uploadRunBundle(
      {
        id: campaign.id,
        benchmark: "gpqa_retry_comparison",
        root,
        startedAt: campaign.startedAt,
        finishedAt: campaign.finishedAt,
        status: campaign.status,
        exitCode: null,
        failureReason: campaign.failureReason,
      },
      dependencies
    );
    campaign.uploadStatus = "complete";
    campaign.uploadedAt = uploaded.uploadedAt;
    campaign.spacesBucket = uploaded.bucket;
    campaign.spacesPrefix = uploaded.prefix;
    campaign.manifestKey = uploaded.manifestKey;
    await requiredStore().upsert(campaign);
    rmSync(root, { recursive: true, force: true });
  } catch (error) {
    campaign.uploadStatus = "failed";
    campaign.uploadError = String(error);
    await requiredStore().upsert(campaign);
  }
  return campaign;
}
