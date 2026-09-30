import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSweBenchTask, resolveSweBenchTasksDir } from "./tasks-source";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTask(dockerfile = DOCKERFILE): string {
  const root = mkdtempSync(join(tmpdir(), "swe-bench-task-"));
  roots.push(root);
  mkdirSync(join(root, "environment"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "task.toml"), TASK_TOML);
  writeFileSync(join(root, "instruction.md"), "Fix the bug.");
  writeFileSync(join(root, "environment/Dockerfile"), dockerfile);
  writeFileSync(join(root, "tests/test.sh"), "#!/bin/bash\n");
  return root;
}

describe("SWE-bench task source", () => {
  it("loads and validates a generated Harbor task", async () => {
    const task = await loadSweBenchTask(makeTask());

    expect(task.id).toBe("django__django-13741");
    expect(task.dockerImage).toBe(
      "swebench/sweb.eval.x86_64.django_1776_django-13741:latest"
    );
    expect(task.imageBuildSteps).toEqual([
      "RUN curl -LsSf https://astral.sh/uv/0.7.13/install.sh | sh",
      "RUN mkdir -p /logs",
    ]);
    expect(task.taskToml.environment.storage_mb).toBe(10_240);
  });

  it("rejects multi-stage task Dockerfiles", async () => {
    const taskDir = makeTask(`${DOCKERFILE}\nFROM busybox:latest\n`);
    await expect(loadSweBenchTask(taskDir)).rejects.toThrow(
      "must contain exactly one FROM"
    );
  });

  it("uses the configured task bundle path", () => {
    expect(
      resolveSweBenchTasksDir(
        { BENCH_SWE_BENCH_TASKS_DIR: "../tasks" },
        "/controller/app"
      )
    ).toBe("/controller/tasks");
  });
});

const TASK_TOML = `
schema_version = "1.0"

[task]
name = "swe-bench/swebench-verified__django__django-13741"
description = "SWE-bench Verified debugging task."

[metadata]
difficulty = "<15 min fix"
category = "debugging"

[verifier]
network_mode = "public"
timeout_sec = 3000

[agent]
network_mode = "public"
timeout_sec = 3000

[environment]
build_timeout_sec = 1800.0
cpus = 1
memory_mb = 4096
storage_mb = 10240
gpus = 0
`;

const DOCKERFILE = `
FROM swebench/sweb.eval.x86_64.django_1776_django-13741:latest
WORKDIR /testbed
RUN curl -LsSf https://astral.sh/uv/0.7.13/install.sh | sh
RUN mkdir -p /logs
`;
