import { describe, expect, it } from "bun:test";

import {
  sweAtlasDigitalOceanSandboxEnv,
  sweAtlasSandboxBackend,
} from "./benchmark";

describe("SWE Atlas sandbox selection", () => {
  it("defaults to Modal", () => {
    expect(sweAtlasSandboxBackend()).toBe("modal");
    expect(sweAtlasSandboxBackend("")).toBe("modal");
  });

  it("selects DigitalOcean case-insensitively", () => {
    expect(sweAtlasSandboxBackend("digitalocean")).toBe("digitalocean");
    expect(sweAtlasSandboxBackend(" DigitalOcean ")).toBe("digitalocean");
  });

  it("rejects unsupported backends", () => {
    expect(() => sweAtlasSandboxBackend("other")).toThrow(
      'expected "modal" or "digitalocean"'
    );
  });

  it("uses an Atlas-specific Droplet size with a shared fallback", () => {
    const shared = { DO_SANDBOX_SIZE: "s-4vcpu-8gb" };
    expect(sweAtlasDigitalOceanSandboxEnv(shared)["DO_SANDBOX_SIZE"]).toBe(
      "s-4vcpu-8gb"
    );
    expect(
      sweAtlasDigitalOceanSandboxEnv({
        ...shared,
        SWE_ATLAS_DO_SANDBOX_SIZE: " c-16 ",
      })["DO_SANDBOX_SIZE"]
    ).toBe("c-16");
  });
});
