import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { SpacesClient, SpacesConfig } from "../internal/spaces";
import { makeSpacesClient, spacesConfigFromEnv } from "../internal/spaces";

interface BundleFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly contentType: string;
}

export interface RunBundleMetadata {
  readonly id: string;
  readonly benchmark: string;
  readonly root: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly status: string;
  readonly exitCode: number | null;
}

export interface UploadResult {
  readonly bucket: string;
  readonly prefix: string;
  readonly manifestKey: string;
  readonly uploadedAt: string;
}

export interface UploadDependencies {
  readonly config?: SpacesConfig;
  readonly client?: SpacesClient;
}

function contentType(path: string): string {
  if (path.endsWith(".json")) {
    return "application/json";
  }
  if (path.endsWith(".jsonl")) {
    return "application/x-ndjson";
  }
  if (path.endsWith(".parquet")) {
    return "application/vnd.apache.parquet";
  }
  if (path.endsWith(".log") || path.endsWith(".txt")) {
    return "text/plain; charset=utf-8";
  }
  if (path.endsWith(".md")) {
    return "text/markdown; charset=utf-8";
  }
  return "application/octet-stream";
}

function walk(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(root, path) : [path];
  });
}

function describeFile(root: string, path: string): BundleFile {
  const content = readFileSync(path);
  return {
    relativePath: relative(root, path).split(sep).join("/"),
    absolutePath: path,
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    contentType: contentType(path),
  };
}

function remotePrefix(config: SpacesConfig, run: RunBundleMetadata): string {
  const date = new Date(run.startedAt);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const benchmarkPrefix =
    run.benchmark === "gpqa_diamond" ? "gpqa" : run.benchmark;
  return [config.prefix, benchmarkPrefix, year, month, day, run.id]
    .filter(Boolean)
    .join("/");
}

export async function uploadRunBundle(
  run: RunBundleMetadata,
  dependencies: UploadDependencies = {}
): Promise<UploadResult> {
  const config = dependencies.config ?? spacesConfigFromEnv();
  const client = dependencies.client ?? makeSpacesClient(config);
  const prefix = remotePrefix(config, run);
  const manifestPath = join(run.root, "manifest.json");
  const files = walk(run.root)
    .filter((path) => path !== manifestPath)
    .map((path) => describeFile(run.root, path))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const file of files) {
    await client.putFile({
      key: `${prefix}/${file.relativePath}`,
      path: file.absolutePath,
      contentType: file.contentType,
    });
  }

  const uploadedAt = new Date().toISOString();
  const manifest = {
    formatVersion: 1,
    runId: run.id,
    benchmark: run.benchmark,
    status: run.status,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    uploadedAt,
    files: files.map(({ relativePath, bytes, sha256, contentType: type }) => ({
      path: relativePath,
      bytes,
      sha256,
      contentType: type,
    })),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestKey = `${prefix}/manifest.json`;
  await client.putFile({
    key: manifestKey,
    path: manifestPath,
    contentType: "application/json",
  });

  return {
    bucket: config.bucket,
    prefix,
    manifestKey,
    uploadedAt,
  };
}
