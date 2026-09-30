import type { SpacesArtifactClient } from "../internal/spaces";
import { z } from "../internal/zod";
import type { RunMetadata } from "./run-metadata-store";

const LOG_TAIL_BYTES = 8 * 1024 * 1024;

const BundleManifestSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      bytes: z.number().int().nonnegative(),
      contentType: z.string().min(1),
    })
  ),
});

interface RemoteArtifact {
  readonly key: string;
  readonly filename: string;
  readonly contentType: string;
  readonly bytes?: number | undefined;
}

let spacesClient: SpacesArtifactClient | undefined;

export function configureRunArtifactClient(
  client: SpacesArtifactClient | undefined
): void {
  spacesClient = client;
}

function requiredClient(): SpacesArtifactClient {
  if (spacesClient === undefined) {
    throw new Error("Spaces artifact client is not configured");
  }
  return spacesClient;
}

function remotePrefix(metadata: RunMetadata): string {
  if (
    metadata.uploadStatus !== "complete" ||
    metadata.spacesPrefix === null ||
    metadata.spacesBucket === null
  ) {
    throw new Error(`Run ${metadata.id} has no completed Spaces upload`);
  }
  const client = requiredClient();
  if (metadata.spacesBucket !== client.bucket) {
    throw new Error(
      `Run ${metadata.id} is stored in unexpected Spaces bucket ${metadata.spacesBucket}`
    );
  }
  return metadata.spacesPrefix;
}

async function readBytes(key: string): Promise<Uint8Array | undefined> {
  const object = await requiredClient().getFile({ key });
  return object === undefined
    ? undefined
    : new Uint8Array(await new Response(object.body).arrayBuffer());
}

async function parquetArtifact(
  metadata: RunMetadata
): Promise<RemoteArtifact | undefined> {
  const prefix = remotePrefix(metadata);
  const manifestKey = metadata.manifestKey ?? `${prefix}/manifest.json`;
  const manifestBytes = await readBytes(manifestKey);
  if (manifestBytes === undefined) {
    return undefined;
  }
  const raw: unknown = JSON.parse(new TextDecoder().decode(manifestBytes));
  const manifest = BundleManifestSchema.parse(raw);
  const file = manifest.files
    .filter(({ path }) => path.endsWith(".parquet"))
    .sort((a, b) => a.path.localeCompare(b.path))
    .at(-1);
  if (file === undefined) {
    return undefined;
  }
  return {
    key: `${prefix}/${file.path}`,
    filename: file.path.split("/").at(-1) ?? `${metadata.id}-results.parquet`,
    contentType: file.contentType,
    bytes: file.bytes,
  };
}

function fixedArtifact(
  metadata: RunMetadata,
  kind: "logs" | "requests" | "state"
): RemoteArtifact {
  const prefix = remotePrefix(metadata);
  switch (kind) {
    case "logs": {
      return {
        key: `${prefix}/logs/run.log`,
        filename: `${metadata.id}-run.log`,
        contentType: "text/plain; charset=utf-8",
      };
    }
    case "requests": {
      return {
        key: `${prefix}/requests/requests.jsonl`,
        filename: `${metadata.id}-requests.jsonl`,
        contentType: "application/x-ndjson; charset=utf-8",
      };
    }
    case "state": {
      return {
        key: `${prefix}/run.json`,
        filename: `${metadata.id}-run.json`,
        contentType: "application/json; charset=utf-8",
      };
    }
  }
}

async function artifactResponse(
  artifact: RemoteArtifact,
  download: boolean
): Promise<Response | undefined> {
  const client = requiredClient();
  if (download) {
    const location = await client.signedGetUrl({
      key: artifact.key,
      filename: artifact.filename.replaceAll(/[^A-Za-z0-9._-]/gu, "_"),
      contentType: artifact.contentType,
    });
    return new Response(null, {
      headers: {
        "X-Artifact-Download-Url": location,
        "Cache-Control": "private, no-store",
      },
    });
  }
  const object = await client.getFile({ key: artifact.key });
  if (object === undefined) {
    return undefined;
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": object.contentType ?? artifact.contentType,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function remoteRunArtifactResponse(
  metadata: RunMetadata,
  kind: "logs" | "requests" | "state" | "parquet" | "gpqa-report",
  download: boolean
): Promise<Response | undefined> {
  let artifact: RemoteArtifact | undefined;
  if (kind === "parquet") {
    artifact = await parquetArtifact(metadata);
  } else if (kind === "gpqa-report") {
    const prefix = remotePrefix(metadata);
    artifact = {
      key: `${prefix}/reports/gpqa-report.json`,
      filename: `${metadata.id}-gpqa-report.json`,
      contentType: "application/json; charset=utf-8",
    };
  } else {
    artifact = fixedArtifact(metadata, kind);
  }
  return artifact === undefined
    ? undefined
    : artifactResponse(artifact, download);
}

export async function readRemotePrecomputedGpqaReport(
  metadata: RunMetadata
): Promise<Uint8Array | undefined> {
  const prefix = remotePrefix(metadata);
  return readBytes(`${prefix}/reports/gpqa-report.json`);
}

export async function remoteRunLogTailResponse(
  metadata: RunMetadata,
  lines: number
): Promise<Response | undefined> {
  const artifact = fixedArtifact(metadata, "logs");
  const object = await requiredClient().getFile({
    key: artifact.key,
    range: `bytes=-${LOG_TAIL_BYTES}`,
  });
  if (object === undefined) {
    return undefined;
  }
  const raw = await new Response(object.body).text();
  const split = raw.split("\n");
  const body = split.slice(Math.max(0, split.length - lines)).join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": artifact.contentType,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function readRemoteRunParquet(
  metadata: RunMetadata
): Promise<{ readonly file: string; readonly bytes: Uint8Array } | undefined> {
  const artifact = await parquetArtifact(metadata);
  if (artifact === undefined) {
    return undefined;
  }
  const bytes = await readBytes(artifact.key);
  return bytes === undefined ? undefined : { file: artifact.filename, bytes };
}

export async function describeRemoteRunParquet(metadata: RunMetadata): Promise<
  | {
      readonly runId: string;
      readonly file: string;
      readonly path: string;
      readonly bytes: number;
      readonly modifiedAt: string;
    }
  | undefined
> {
  const artifact = await parquetArtifact(metadata);
  return artifact === undefined
    ? undefined
    : {
        runId: metadata.id,
        file: artifact.filename,
        path: `s3://${requiredClient().bucket}/${artifact.key}`,
        bytes: artifact.bytes ?? 0,
        modifiedAt: metadata.uploadedAt ?? metadata.startedAt,
      };
}
