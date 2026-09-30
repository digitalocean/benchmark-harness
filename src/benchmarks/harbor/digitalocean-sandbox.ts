import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import type { Effect } from "effect/Effect";
import {
  catchAll,
  gen,
  tapError,
  tryPromise,
  void as effectVoid,
} from "effect/Effect";
import type { Layer } from "effect/Layer";
import { fail as layerFail, succeed } from "effect/Layer";

import { SolverError } from "../../harness/core";
import { z } from "../../internal/zod";
import type {
  CreateSessionInput,
  SandboxExec,
  SandboxSessionInstance,
  UploadSpec,
} from "./sandbox";
import { SandboxSession, makeSessionInstance, toSolverError } from "./sandbox";

const DEFAULT_API_BASE_URL = "https://api.digitalocean.com/v2";
const DEFAULT_ACTIVE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_READY_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const IMAGE_OPERATION_TIMEOUT_MS = 30 * 60 * 1000;
const SSH_PROBE_TIMEOUT_MS = 15_000;
const CONTAINER_NAME = "benchmark-session";
const SESSION_PREFIX = "do";
const execFileAsync = promisify(execFile);

const DropletSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.string(),
  networks: z.object({
    v4: z.array(
      z.object({
        ip_address: z.string(),
        type: z.string(),
      })
    ),
  }),
});

const DropletResponseSchema = z.object({
  droplet: DropletSchema,
});

type Droplet = z.infer<typeof DropletSchema>;

export interface DigitalOceanSandboxConfig {
  readonly token: string;
  readonly sshKeyId: string;
  readonly sshPrivateKeyPath: string;
  readonly region: string;
  readonly size: string;
  readonly image: string;
  readonly apiBaseUrl?: string;
  readonly activeTimeoutMs?: number;
  readonly readyTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface DigitalOceanSandboxDependencies {
  readonly fetch: typeof fetch;
  readonly runProcess: (
    command: string,
    args: readonly string[],
    timeoutMs: number
  ) => Promise<ProcessResult>;
  readonly sleep: (durationMs: number) => Promise<void>;
  readonly now: () => number;
  readonly randomId: () => string;
}

const defaultDependencies: DigitalOceanSandboxDependencies = {
  fetch,
  runProcess: runProcessDefault,
  sleep: delay,
  now: Date.now,
  randomId: randomUUID,
};

function requiredEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set for the DigitalOcean sandbox`);
  }
  return value;
}

export function digitalOceanSandboxConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env
): DigitalOceanSandboxConfig {
  const sshPrivateKeyPath = requiredEnv(env, "DO_SANDBOX_SSH_PRIVATE_KEY_PATH");
  if (!existsSync(sshPrivateKeyPath)) {
    throw new Error(
      `DO_SANDBOX_SSH_PRIVATE_KEY_PATH does not exist: ${sshPrivateKeyPath}`
    );
  }
  return {
    token: requiredEnv(env, "DO_SANDBOX_TOKEN"),
    sshKeyId: requiredEnv(env, "DO_SANDBOX_SSH_KEY_ID"),
    sshPrivateKeyPath,
    region: requiredEnv(env, "DO_SANDBOX_REGION"),
    size: requiredEnv(env, "DO_SANDBOX_SIZE"),
    image: requiredEnv(env, "DO_SANDBOX_IMAGE"),
  };
}

export function makeDigitalOceanSandboxLayerFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env
): Layer<SandboxSession, Error> {
  try {
    return makeDigitalOceanSandboxLayer(digitalOceanSandboxConfigFromEnv(env));
  } catch (error) {
    return layerFail(error instanceof Error ? error : new Error(String(error)));
  }
}

export function makeDigitalOceanSandboxLayer(
  config: DigitalOceanSandboxConfig,
  dependencies?: Partial<DigitalOceanSandboxDependencies>
): Layer<SandboxSession> {
  const deps = { ...defaultDependencies, ...dependencies };
  const client = makeDigitalOceanClient(config, deps);

  const create = (
    input: CreateSessionInput
  ): Effect<SandboxSessionInstance, SolverError> => {
    let dropletId: number | undefined;
    return gen(function* createSession() {
      const created = yield* tryPromise({
        try: () =>
          client.createDroplet(
            `bench-${deps.randomId().replaceAll("-", "").slice(0, 20)}`
          ),
        catch: (error) =>
          toSolverError("Failed to create DigitalOcean Droplet", error),
      });
      dropletId = created.id;
      const active = yield* tryPromise({
        try: () => client.waitUntilActive(created.id),
        catch: (error) =>
          toSolverError(`Droplet ${created.id} did not become active`, error),
      });
      const ipAddress = publicIpv4(active);
      yield* tryPromise({
        try: () => prepareDroplet(config, deps, created.id, ipAddress, input),
        catch: (error) =>
          toSolverError(`Failed to prepare Droplet ${created.id}`, error),
      });
      return makeDropletSession(config, deps, client, created.id, ipAddress);
    }).pipe(
      tapError(() => {
        if (dropletId === undefined) {
          return effectVoid;
        }
        const failedDropletId = dropletId;
        return tryPromise({
          try: () => client.deleteDroplet(failedDropletId),
          catch: () => undefined,
        }).pipe(catchAll(() => effectVoid));
      })
    );
  };

  const attach = (
    sandboxId: string
  ): Effect<SandboxSessionInstance, SolverError> =>
    gen(function* attachSession() {
      const dropletId = parseSessionId(sandboxId);
      if (dropletId === undefined) {
        return yield* new SolverError({
          message: `Invalid DigitalOcean sandbox ID: ${sandboxId}`,
        });
      }
      const droplet = yield* tryPromise({
        try: () => client.getDroplet(dropletId),
        catch: (error) =>
          toSolverError(`Failed to retrieve Droplet ${dropletId}`, error),
      });
      const ipAddress = publicIpv4OrUndefined(droplet);
      if (ipAddress === undefined) {
        return yield* new SolverError({
          message: `Droplet ${dropletId} has no public IPv4 address`,
        });
      }
      yield* tryPromise({
        try: () =>
          requireRemoteSuccess(
            config,
            deps,
            dropletId,
            ipAddress,
            ["docker", "inspect", CONTAINER_NAME],
            SSH_PROBE_TIMEOUT_MS,
            "attached container probe"
          ),
        catch: (error) =>
          toSolverError(
            `Failed to attach to Droplet ${dropletId} container`,
            error
          ),
      });
      return makeDropletSession(config, deps, client, dropletId, ipAddress);
    });

  return succeed(SandboxSession, { create, attach });
}

function makeDigitalOceanClient(
  config: DigitalOceanSandboxConfig,
  deps: DigitalOceanSandboxDependencies
) {
  const apiBaseUrl = (config.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(
    /\/+$/u,
    ""
  );
  const headers = {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
  };

  const requestDroplet = async (
    path: string,
    init?: RequestInit
  ): Promise<Droplet> => {
    const response = await deps.fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `DigitalOcean API ${response.status}: ${detail.slice(0, 1000)}`
      );
    }
    const parsed = DropletResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(
        `Invalid DigitalOcean Droplet response: ${parsed.error.message}`
      );
    }
    return parsed.data.droplet;
  };

  const getDroplet = (dropletId: number): Promise<Droplet> =>
    requestDroplet(`/droplets/${dropletId}`);

  return {
    createDroplet: (name: string): Promise<Droplet> =>
      requestDroplet("/droplets", {
        method: "POST",
        body: JSON.stringify({
          name,
          region: config.region,
          size: config.size,
          image: config.image,
          ssh_keys: [numericOrString(config.sshKeyId)],
          backups: false,
          ipv6: false,
          monitoring: false,
          user_data: cloudInitScript(),
        }),
      }),
    getDroplet,
    waitUntilActive: async (dropletId: number): Promise<Droplet> => {
      const deadline =
        deps.now() + (config.activeTimeoutMs ?? DEFAULT_ACTIVE_TIMEOUT_MS);
      while (deps.now() < deadline) {
        const droplet = await getDroplet(dropletId);
        if (droplet.status === "active" && publicIpv4OrUndefined(droplet)) {
          return droplet;
        }
        await deps.sleep(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
      }
      throw new Error("timed out waiting for active status and public IPv4");
    },
    deleteDroplet: async (dropletId: number): Promise<void> => {
      const response = await deps.fetch(`${apiBaseUrl}/droplets/${dropletId}`, {
        method: "DELETE",
        headers,
      });
      if (!(response.ok || response.status === 404)) {
        const detail = await response.text();
        throw new Error(
          `DigitalOcean delete failed (${response.status}): ${detail.slice(0, 1000)}`
        );
      }
    },
  };
}

type DigitalOceanClient = ReturnType<typeof makeDigitalOceanClient>;

function numericOrString(value: string): number | string {
  return /^\d+$/u.test(value) ? Number(value) : value;
}

function publicIpv4OrUndefined(droplet: Droplet): string | undefined {
  return droplet.networks.v4.find((network) => network.type === "public")
    ?.ip_address;
}

function publicIpv4(droplet: Droplet): string {
  const ipAddress = publicIpv4OrUndefined(droplet);
  if (!ipAddress) {
    throw new Error(`Droplet ${droplet.id} has no public IPv4 address`);
  }
  return ipAddress;
}

function parseSessionId(sessionId: string): number | undefined {
  const match = /^do:(\d+)$/u.exec(sessionId);
  if (!match?.[1]) {
    return undefined;
  }
  return Number(match[1]);
}

function sessionId(dropletId: number): string {
  return `${SESSION_PREFIX}:${dropletId}`;
}

function knownHostsPath(dropletId: number): string {
  return join(tmpdir(), `benchmark-harness-do-${dropletId}.known-hosts`);
}

function sshOptions(
  config: DigitalOceanSandboxConfig,
  dropletId: number
): string[] {
  return [
    "-i",
    config.sshPrivateKeyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile=${knownHostsPath(dropletId)}`,
  ];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function shellJoin(argv: readonly string[]): string {
  return argv.map(shellQuote).join(" ");
}

async function runSsh(
  config: DigitalOceanSandboxConfig,
  deps: DigitalOceanSandboxDependencies,
  dropletId: number,
  ipAddress: string,
  argv: readonly string[],
  timeoutMs: number
): Promise<ProcessResult> {
  return deps.runProcess(
    "ssh",
    [...sshOptions(config, dropletId), `root@${ipAddress}`, shellJoin(argv)],
    timeoutMs
  );
}

async function requireRemoteSuccess(
  config: DigitalOceanSandboxConfig,
  deps: DigitalOceanSandboxDependencies,
  dropletId: number,
  ipAddress: string,
  argv: readonly string[],
  timeoutMs: number,
  context: string
): Promise<ProcessResult> {
  const result = await runSsh(
    config,
    deps,
    dropletId,
    ipAddress,
    argv,
    timeoutMs
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `${context} exited ${result.exitCode}: ${`${result.stdout}\n${result.stderr}`.trim().slice(-2000)}`
    );
  }
  return result;
}

async function waitUntilReady(
  config: DigitalOceanSandboxConfig,
  deps: DigitalOceanSandboxDependencies,
  dropletId: number,
  ipAddress: string
): Promise<void> {
  const deadline =
    deps.now() + (config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
  let lastError: unknown;
  while (deps.now() < deadline) {
    try {
      await requireRemoteSuccess(
        config,
        deps,
        dropletId,
        ipAddress,
        [
          "bash",
          "-lc",
          "test -f /var/lib/benchmark-harness-ready && docker info >/dev/null",
        ],
        SSH_PROBE_TIMEOUT_MS,
        "Docker readiness probe"
      );
      return;
    } catch (error) {
      lastError = error;
      await deps.sleep(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    }
  }
  throw new Error(
    `timed out waiting for Docker readiness: ${String(lastError)}`
  );
}

async function prepareDroplet(
  config: DigitalOceanSandboxConfig,
  deps: DigitalOceanSandboxDependencies,
  dropletId: number,
  ipAddress: string,
  input: CreateSessionInput
): Promise<void> {
  await waitUntilReady(config, deps, dropletId, ipAddress);
  await requireRemoteSuccess(
    config,
    deps,
    dropletId,
    ipAddress,
    ["docker", "pull", input.imageTag],
    IMAGE_OPERATION_TIMEOUT_MS,
    "task image pull"
  );
  const image =
    input.imageBuildSteps && input.imageBuildSteps.length > 0
      ? await buildDerivedImage(
          config,
          deps,
          dropletId,
          ipAddress,
          input.imageTag,
          input.imageBuildSteps
        )
      : input.imageTag;
  const runArgs = [
    "docker",
    "run",
    "--detach",
    "--name",
    CONTAINER_NAME,
    "--cpus",
    String(input.cpus),
    "--memory",
    `${input.memoryMb}m`,
    "--workdir",
    input.workdir,
    ...(!input.allowInternet ? ["--network", "none"] : []),
    image,
    ...input.keepAliveCommand,
  ];
  await requireRemoteSuccess(
    config,
    deps,
    dropletId,
    ipAddress,
    runArgs,
    120_000,
    "task container start"
  );
  await requireRemoteSuccess(
    config,
    deps,
    dropletId,
    ipAddress,
    [
      "docker",
      "exec",
      CONTAINER_NAME,
      "mkdir",
      "-p",
      "/logs/verifier",
      "/logs/agent",
      "/logs/artifacts",
    ],
    30_000,
    "sandbox log directory setup"
  );
  for (const upload of input.uploads) {
    await uploadToContainer(config, deps, dropletId, ipAddress, upload);
  }
}

async function buildDerivedImage(
  config: DigitalOceanSandboxConfig,
  deps: DigitalOceanSandboxDependencies,
  dropletId: number,
  ipAddress: string,
  baseImage: string,
  buildSteps: readonly string[]
): Promise<string> {
  const image = `benchmark-derived:${deps.randomId().replaceAll("-", "")}`;
  const buildDir = `/tmp/benchmark-build-${deps.randomId().replaceAll("-", "")}`;
  const dockerfile = [`FROM ${baseImage}`, ...buildSteps, ""].join("\n");
  const encoded = Buffer.from(dockerfile).toString("base64");
  await requireRemoteSuccess(
    config,
    deps,
    dropletId,
    ipAddress,
    [
      "bash",
      "-lc",
      `mkdir -p ${shellQuote(buildDir)} && printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(`${buildDir}/Dockerfile`)}`,
    ],
    30_000,
    "derived image Dockerfile setup"
  );
  await requireRemoteSuccess(
    config,
    deps,
    dropletId,
    ipAddress,
    [
      "docker",
      "build",
      "--tag",
      image,
      "--file",
      `${buildDir}/Dockerfile`,
      buildDir,
    ],
    IMAGE_OPERATION_TIMEOUT_MS,
    "derived image build"
  );
  return image;
}

function makeDropletSession(
  config: DigitalOceanSandboxConfig,
  deps: DigitalOceanSandboxDependencies,
  client: DigitalOceanClient,
  dropletId: number,
  ipAddress: string
): SandboxSessionInstance {
  const exec: SandboxExec = (argv, env, timeoutMs) =>
    tryPromise({
      try: async () => {
        if (argv.length === 0) {
          throw new Error("exec argv must not be empty");
        }
        const dockerArgs = [
          "timeout",
          "--kill-after=5s",
          `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`,
          "docker",
          "exec",
        ];
        for (const [key, value] of Object.entries(env).toSorted(([a], [b]) =>
          a.localeCompare(b)
        )) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
            throw new Error(`Invalid environment variable name: ${key}`);
          }
          dockerArgs.push("--env", `${key}=${value}`);
        }
        dockerArgs.push(CONTAINER_NAME, ...argv);
        return runSsh(
          config,
          deps,
          dropletId,
          ipAddress,
          dockerArgs,
          timeoutMs + 15_000
        );
      },
      catch: (error) => toSolverError(`exec(${argv.join(" ")}) failed`, error),
    });
  return makeSessionInstance({
    sandboxId: sessionId(dropletId),
    exec,
    uploadFile: (localPath, remotePath) =>
      uploadToContainer(config, deps, dropletId, ipAddress, {
        localPath,
        remotePath,
        kind: "file",
      }),
    uploadDir: (localPath, remotePath) =>
      uploadToContainer(config, deps, dropletId, ipAddress, {
        localPath,
        remotePath,
        kind: "dir",
      }),
    downloadFile: (remotePath, localPath) =>
      downloadFromContainer(
        config,
        deps,
        dropletId,
        ipAddress,
        remotePath,
        localPath
      ),
    terminate: async () => {
      await client.deleteDroplet(dropletId);
      rmSync(knownHostsPath(dropletId), { force: true });
    },
  });
}

async function uploadToContainer(
  config: DigitalOceanSandboxConfig,
  deps: DigitalOceanSandboxDependencies,
  dropletId: number,
  ipAddress: string,
  upload: UploadSpec
): Promise<void> {
  const stage = `/tmp/benchmark-upload-${deps.randomId().replaceAll("-", "")}`;
  const scpArgs = [
    ...sshOptions(config, dropletId),
    ...(upload.kind === "dir" ? ["-r"] : []),
    upload.localPath,
    `root@${ipAddress}:${stage}`,
  ];
  const copied = await deps.runProcess("scp", scpArgs, 10 * 60 * 1000);
  if (copied.exitCode !== 0) {
    throw new Error(
      `SCP upload exited ${copied.exitCode}: ${copied.stderr.slice(-2000)}`
    );
  }
  try {
    await requireRemoteSuccess(
      config,
      deps,
      dropletId,
      ipAddress,
      [
        "docker",
        "exec",
        CONTAINER_NAME,
        "mkdir",
        "-p",
        dirname(upload.remotePath),
      ],
      30_000,
      "upload destination setup"
    );
    await requireRemoteSuccess(
      config,
      deps,
      dropletId,
      ipAddress,
      ["docker", "cp", stage, `${CONTAINER_NAME}:${upload.remotePath}`],
      10 * 60 * 1000,
      "container upload"
    );
  } finally {
    await runSsh(
      config,
      deps,
      dropletId,
      ipAddress,
      ["rm", "-rf", stage],
      30_000
    ).catch(() => undefined);
  }
}

async function downloadFromContainer(
  config: DigitalOceanSandboxConfig,
  deps: DigitalOceanSandboxDependencies,
  dropletId: number,
  ipAddress: string,
  remotePath: string,
  localPath: string
): Promise<void> {
  const stage = `/tmp/benchmark-download-${deps.randomId().replaceAll("-", "")}-${basename(remotePath)}`;
  await requireRemoteSuccess(
    config,
    deps,
    dropletId,
    ipAddress,
    ["docker", "cp", `${CONTAINER_NAME}:${remotePath}`, stage],
    10 * 60 * 1000,
    "container download staging"
  );
  mkdirSync(dirname(localPath), { recursive: true });
  try {
    const copied = await deps.runProcess(
      "scp",
      [
        ...sshOptions(config, dropletId),
        `root@${ipAddress}:${stage}`,
        localPath,
      ],
      10 * 60 * 1000
    );
    if (copied.exitCode !== 0) {
      throw new Error(
        `SCP download exited ${copied.exitCode}: ${copied.stderr.slice(-2000)}`
      );
    }
  } finally {
    await runSsh(
      config,
      deps,
      dropletId,
      ipAddress,
      ["rm", "-rf", stage],
      30_000
    ).catch(() => undefined);
  }
}

function cloudInitScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates docker.io
systemctl enable --now docker
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
touch /var/lib/benchmark-harness-ready
`;
}

async function runProcessDefault(
  command: string,
  args: readonly string[],
  timeoutMs: number
): Promise<ProcessResult> {
  try {
    const result = await execFileAsync(command, [...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const processError = error as {
      readonly code?: unknown;
      readonly stdout?: unknown;
      readonly stderr?: unknown;
    };
    if (typeof processError.code !== "number") {
      throw error;
    }
    return {
      stdout:
        typeof processError.stdout === "string" ? processError.stdout : "",
      stderr:
        typeof processError.stderr === "string" ? processError.stderr : "",
      exitCode: processError.code,
    };
  }
}
