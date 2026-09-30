import { describe, expect, it } from "bun:test";

import { gen, provide, runPromise } from "effect/Effect";

import type { ProcessResult } from "./digitalocean-sandbox";
import { makeDigitalOceanSandboxLayer } from "./digitalocean-sandbox";
import type { CreateSessionInput } from "./sandbox";
import { SandboxSession } from "./sandbox";

const CONFIG = {
  token: "dop_test",
  sshKeyId: "59533271",
  sshPrivateKeyPath: "/tmp/test-key",
  region: "nyc3",
  size: "s-4vcpu-8gb",
  image: "ubuntu-24-04-x64",
  apiBaseUrl: "https://api.test/v2",
  activeTimeoutMs: 1000,
  readyTimeoutMs: 1000,
  pollIntervalMs: 1,
} as const;

const CREATE_INPUT: CreateSessionInput = {
  imageTag: "public.ecr.aws/example/task:v1",
  timeoutSec: 3600,
  cpus: 2,
  memoryMb: 8192,
  allowInternet: false,
  workdir: "/app",
  keepAliveCommand: ["sleep", "infinity"],
  uploads: [],
};

function dropletResponse() {
  return {
    droplet: {
      id: 42,
      name: "bench-test",
      status: "active",
      networks: {
        v4: [{ ip_address: "203.0.113.10", type: "public" }],
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DigitalOcean sandbox", () => {
  it("creates, executes in, and deletes a Droplet-backed container", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const processes: {
      command: string;
      args: readonly string[];
      timeoutMs: number;
    }[] = [];
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, ...(init !== undefined && { init }) });
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse(dropletResponse());
    }) as typeof fetch;
    const runProcess = async (
      command: string,
      args: readonly string[],
      timeoutMs: number
    ): Promise<ProcessResult> => {
      processes.push({ command, args, timeoutMs });
      return {
        stdout: command === "ssh" ? "command output" : "",
        stderr: "",
        exitCode: 0,
      };
    };
    const layer = makeDigitalOceanSandboxLayer(CONFIG, {
      fetch: fetcher,
      runProcess,
      sleep: () => Promise.resolve(),
      now: () => 0,
      randomId: () => "00000000-0000-0000-0000-000000000000",
    });

    const result = await runPromise(
      gen(function* () {
        const factory = yield* SandboxSession;
        const session = yield* factory.create(CREATE_INPUT);
        const execution = yield* session.exec(
          ["bash", "-lc", "printf done"],
          { TEST_ENV: "value" },
          30_000
        );
        yield* session.destroy();
        return { sandboxId: session.sandboxId, execution };
      }).pipe(provide(layer))
    );

    expect(result.sandboxId).toBe("do:42");
    expect(result.execution).toEqual({
      stdout: "command output",
      stderr: "",
      exitCode: 0,
    });
    const createRequest = requests.find(({ init }) => init?.method === "POST");
    expect(createRequest).toBeDefined();
    expect(JSON.parse(String(createRequest?.init?.body))).toMatchObject({
      region: "nyc3",
      size: "s-4vcpu-8gb",
      image: "ubuntu-24-04-x64",
      ssh_keys: [59533271],
    });
    expect(
      processes.some(({ args }) =>
        args
          .at(-1)
          ?.includes(
            "'docker' 'run' '--detach' '--name' 'benchmark-session' '--cpus' '2'"
          )
      )
    ).toBe(true);
    expect(
      processes.some(({ args }) => args.at(-1)?.includes("'--network' 'none'"))
    ).toBe(true);
    expect(
      processes.some(({ args }) =>
        args.at(-1)?.includes("'--env' 'TEST_ENV=value'")
      )
    ).toBe(true);
    expect(
      requests.some(
        ({ init, url }) =>
          init?.method === "DELETE" && url.endsWith("/droplets/42")
      )
    ).toBe(true);
  });

  it("deletes the Droplet when container preparation fails", async () => {
    const methods: string[] = [];
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse(dropletResponse());
    }) as typeof fetch;
    const runProcess = async (
      command: string,
      args: readonly string[]
    ): Promise<ProcessResult> => ({
      stdout: "",
      stderr: "pull failed",
      exitCode:
        command === "ssh" && args.at(-1)?.includes("'docker' 'pull'") ? 1 : 0,
    });
    const layer = makeDigitalOceanSandboxLayer(CONFIG, {
      fetch: fetcher,
      runProcess,
      sleep: () => Promise.resolve(),
      now: () => 0,
      randomId: () => "failed-create",
    });

    const run = runPromise(
      gen(function* () {
        const factory = yield* SandboxSession;
        return yield* factory.create(CREATE_INPUT);
      }).pipe(provide(layer))
    );

    await expect(run).rejects.toThrow("task image pull exited 1");
    expect(methods).toContain("DELETE");
  });

  it("rejects malformed attach IDs before calling DigitalOcean", async () => {
    let fetched = false;
    const layer = makeDigitalOceanSandboxLayer(CONFIG, {
      fetch: (async () => {
        fetched = true;
        return jsonResponse(dropletResponse());
      }) as unknown as typeof fetch,
    });

    const run = runPromise(
      gen(function* () {
        const factory = yield* SandboxSession;
        return yield* factory.attach("modal-id");
      }).pipe(provide(layer))
    );

    await expect(run).rejects.toThrow(
      "Invalid DigitalOcean sandbox ID: modal-id"
    );
    expect(fetched).toBe(false);
  });
});
