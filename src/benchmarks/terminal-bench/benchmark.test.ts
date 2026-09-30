import { describe, expect, it } from "bun:test";

import { terminalBenchSandboxBackend } from "./benchmark";

describe("Terminal-Bench sandbox selection", () => {
  it("defaults to Modal", () => {
    expect(terminalBenchSandboxBackend()).toBe("modal");
    expect(terminalBenchSandboxBackend("")).toBe("modal");
  });

  it("selects DigitalOcean case-insensitively", () => {
    expect(terminalBenchSandboxBackend("digitalocean")).toBe("digitalocean");
    expect(terminalBenchSandboxBackend(" DigitalOcean ")).toBe("digitalocean");
  });

  it("rejects unsupported backends", () => {
    expect(() => terminalBenchSandboxBackend("other")).toThrow(
      'expected "modal" or "digitalocean"'
    );
  });
});
