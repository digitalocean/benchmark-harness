import { createReadStream, readFileSync, statSync } from "node:fs";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { unknownErrorToString } from "./errors";
import { isRecord } from "./guards";
import { wLog } from "./log";

const MULTIPART_PART_SIZE = 8 * 1024 * 1024;
const MULTIPART_QUEUE_SIZE = 2;
const UPLOAD_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 500;

export interface SpacesConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly prefix: string;
  readonly forcePathStyle: boolean;
}

const REQUIRED_ENV = [
  "SPACES_ENDPOINT",
  "SPACES_REGION",
  "SPACES_BUCKET",
  "SPACES_ACCESS_KEY_ID",
  "SPACES_SECRET_ACCESS_KEY",
] as const;

export function spacesConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SpacesConfig {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing Spaces environment variables: ${missing.join(", ")}`
    );
  }
  return {
    endpoint: env["SPACES_ENDPOINT"]!.replace(/\/+$/u, ""),
    region: env["SPACES_REGION"]!,
    bucket: env["SPACES_BUCKET"]!,
    accessKeyId: env["SPACES_ACCESS_KEY_ID"]!,
    secretAccessKey: env["SPACES_SECRET_ACCESS_KEY"]!,
    prefix: (env["SPACES_PREFIX"] ?? "benchmark-runs").replaceAll(
      /^\/+|\/+$/gu,
      ""
    ),
    forcePathStyle: env["SPACES_FORCE_PATH_STYLE"] === "1",
  };
}

export interface SpacesPutInput {
  readonly key: string;
  readonly path: string;
  readonly contentType: string;
}

export interface SpacesClient {
  readonly putFile: (input: SpacesPutInput) => Promise<void>;
}

export interface SpacesGetInput {
  readonly key: string;
  readonly range?: string | undefined;
}

export interface SpacesGetResult {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentLength?: number | undefined;
  readonly contentType?: string | undefined;
}

export interface SpacesArtifactClient extends SpacesClient {
  readonly bucket: string;
  readonly getFile: (
    input: SpacesGetInput
  ) => Promise<SpacesGetResult | undefined>;
  readonly signedGetUrl: (input: {
    readonly key: string;
    readonly filename: string;
    readonly contentType: string;
    readonly expiresInSeconds?: number | undefined;
  }) => Promise<string>;
}

export interface SpacesErrorDetails {
  readonly name: string;
  readonly message: string;
  readonly code?: string | undefined;
  readonly httpStatusCode?: number | undefined;
  readonly requestId?: string | undefined;
  readonly extendedRequestId?: string | undefined;
  readonly cfId?: string | undefined;
  readonly attempts?: number | undefined;
  readonly totalRetryDelay?: number | undefined;
  readonly stack?: string | undefined;
  readonly cause?: SpacesErrorDetails | undefined;
}

function property(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, name)
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function spacesErrorDetails(
  error: unknown,
  causeDepth = 0
): SpacesErrorDetails {
  const metadataValue = property(error, "$metadata");
  const metadata = isRecord(metadataValue) ? metadataValue : {};
  const responseValue = property(error, "$response");
  const response = isRecord(responseValue) ? responseValue : {};
  const headersValue = response["headers"];
  const responseHeaders = isRecord(headersValue) ? headersValue : {};
  const code =
    optionalString(property(error, "Code")) ??
    optionalString(property(error, "code"));
  const httpStatusCode =
    optionalNumber(metadata["httpStatusCode"]) ??
    optionalNumber(response["statusCode"]);
  const requestId =
    optionalString(metadata["requestId"]) ??
    optionalString(responseHeaders["x-amz-request-id"]);
  const extendedRequestId =
    optionalString(metadata["extendedRequestId"]) ??
    optionalString(responseHeaders["x-amz-id-2"]);
  const cfId =
    optionalString(metadata["cfId"]) ??
    optionalString(responseHeaders["cf-ray"]);
  const attempts = optionalNumber(metadata["attempts"]);
  const totalRetryDelay = optionalNumber(metadata["totalRetryDelay"]);
  const stack =
    error instanceof Error ? optionalString(error.stack) : undefined;
  const causeValue = property(error, "cause");
  const cause =
    causeDepth < 3 && causeValue !== undefined && causeValue !== error
      ? spacesErrorDetails(causeValue, causeDepth + 1)
      : undefined;
  return {
    name:
      error instanceof Error
        ? error.name
        : (optionalString(property(error, "name")) ?? "UnknownError"),
    message:
      error instanceof Error && error.message.length > 0
        ? error.message
        : unknownErrorToString(error),
    ...(code !== undefined && { code }),
    ...(httpStatusCode !== undefined && { httpStatusCode }),
    ...(requestId !== undefined && { requestId }),
    ...(extendedRequestId !== undefined && { extendedRequestId }),
    ...(cfId !== undefined && { cfId }),
    ...(attempts !== undefined && { attempts }),
    ...(totalRetryDelay !== undefined && { totalRetryDelay }),
    ...(stack !== undefined && { stack }),
    ...(cause !== undefined && { cause }),
  };
}

export function isRetryableSpacesError(details: SpacesErrorDetails): boolean {
  const status = details.httpStatusCode;
  return (
    status === undefined ||
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500
  );
}

function isNotFoundSpacesError(details: SpacesErrorDetails): boolean {
  return (
    details.httpStatusCode === 404 ||
    details.name === "NoSuchKey" ||
    details.name === "NotFound" ||
    details.code === "NoSuchKey"
  );
}

async function uploadFileOnce(
  client: S3Client,
  config: SpacesConfig,
  input: SpacesPutInput,
  bytes: number
): Promise<void> {
  const body =
    bytes <= MULTIPART_PART_SIZE
      ? readFileSync(input.path)
      : createReadStream(input.path);
  try {
    const upload = new Upload({
      client,
      params: {
        Bucket: config.bucket,
        Key: input.key,
        Body: body,
        ContentLength: bytes,
        ContentType: input.contentType,
      },
      queueSize: MULTIPART_QUEUE_SIZE,
      partSize: MULTIPART_PART_SIZE,
      leavePartsOnError: false,
    });
    await upload.done();
  } finally {
    if ("destroy" in body && typeof body.destroy === "function") {
      body.destroy();
    }
  }
}

export function makeSpacesClient(config: SpacesConfig): SpacesArtifactClient {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    maxAttempts: 2,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return {
    bucket: config.bucket,
    getFile: async ({ key, range }) => {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
            ...(range !== undefined && { Range: range }),
          })
        );
        if (result.Body === undefined) {
          throw new Error("Spaces returned an object without a body");
        }
        return {
          body: result.Body.transformToWebStream(),
          ...(result.ContentLength !== undefined && {
            contentLength: result.ContentLength,
          }),
          ...(result.ContentType !== undefined && {
            contentType: result.ContentType,
          }),
        };
      } catch (error) {
        const details = spacesErrorDetails(error);
        if (isNotFoundSpacesError(details)) {
          return undefined;
        }
        throw new Error(
          `Spaces download failed: ${JSON.stringify({
            endpoint: config.endpoint,
            bucket: config.bucket,
            key,
            range,
            error: details,
          })}`,
          { cause: error }
        );
      }
    },
    putFile: async ({ key, path, contentType }) => {
      const bytes = statSync(path).size;
      let lastError: unknown;
      let lastDetails: SpacesErrorDetails | undefined;
      let attemptsMade = 0;
      let totalRetryDelayMs = 0;
      for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
        attemptsMade = attempt;
        try {
          await uploadFileOnce(
            client,
            config,
            { key, path, contentType },
            bytes
          );
          return;
        } catch (error) {
          lastError = error;
          lastDetails = spacesErrorDetails(error);
          if (
            attempt >= UPLOAD_ATTEMPTS ||
            !isRetryableSpacesError(lastDetails)
          ) {
            break;
          }
          const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
          totalRetryDelayMs += delayMs;
          wLog("Retrying Spaces artifact upload", {
            bucket: config.bucket,
            key,
            path,
            bytes,
            attempt,
            next_attempt: attempt + 1,
            delay_ms: delayMs,
            total_retry_delay_ms: totalRetryDelayMs,
            error: lastDetails,
          });
          await Bun.sleep(delayMs);
        }
      }
      const failure = {
        endpoint: config.endpoint,
        bucket: config.bucket,
        key,
        path,
        bytes,
        attempts: attemptsMade,
        totalRetryDelayMs,
        error: lastDetails,
      };
      throw new Error(`Spaces upload failed: ${JSON.stringify(failure)}`, {
        cause: lastError,
      });
    },
    signedGetUrl: ({ key, filename, contentType, expiresInSeconds = 300 }) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${filename}"`,
          ResponseContentType: contentType,
        }),
        { expiresIn: expiresInSeconds }
      ),
  };
}
