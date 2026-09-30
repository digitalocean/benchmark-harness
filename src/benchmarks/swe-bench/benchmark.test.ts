import { describe, expect, it } from "bun:test";

import { sweBenchDigitalOceanSandboxEnv } from "./benchmark";

describe("SWE-bench DigitalOcean sizing", () => {
  it("uses the benchmark-specific size when configured", () => {
    const env = sweBenchDigitalOceanSandboxEnv({
      DO_SANDBOX_SIZE: "s-2vcpu-4gb",
      SWE_BENCH_DO_SANDBOX_SIZE: "s-4vcpu-8gb",
    });
    expect(env["DO_SANDBOX_SIZE"]).toBe("s-4vcpu-8gb");
  });

  it("falls back to the shared DigitalOcean size", () => {
    const original = { DO_SANDBOX_SIZE: "s-4vcpu-8gb" };
    expect(sweBenchDigitalOceanSandboxEnv(original)).toBe(original);
  });
});
