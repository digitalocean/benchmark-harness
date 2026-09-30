import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gen, provide, runPromise, succeed } from "effect/Effect";
import type { Layer } from "effect/Layer";
import {
  effect,
  mergeAll,
  provide as layerProvide,
  succeed as layerSucceed,
} from "effect/Layer";

import {
  noopCheckpointLayer,
  noopProgressLayer,
} from "../../../test/helpers/noop-progress-layer";
import type { Sample } from "../../harness/core";
import { initialTaskState, ScoreValue } from "../../harness/core";
import { Solver } from "../../harness/solver";
import { ResponsesModel } from "../../providers/responses-model";
import { SUBMIT_SENTINEL } from "../harbor/prompts";
import type { ExecResult } from "../harbor/sandbox";
import { makeFakeSandboxLayer, SandboxSession } from "../harbor/sandbox";
import { readSweBenchMeta } from "./dataset";
import { sweBenchScorer } from "./scorer";
import { makeSweBenchSolver } from "./solver";

describe("SWE-bench solver", () => {
  it("captures the patch before uploading tests and persists verifier artifacts", async () => {
    const taskDir = makeTask();
    const events: string[] = [];
    let destroyed = 0;
    const sandboxLayer = makeFakeSandboxLayer({
      onCreate: (input) => {
        expect(input.imageTag).toBe("swebench/example:latest");
        expect(input.imageBuildSteps).toEqual(["RUN mkdir -p /logs"]);
        expect(input.cpus).toBe(1);
        expect(input.memoryMb).toBe(4096);
      },
      onUploadDir: (_local, remote) => events.push(`upload:${remote}`),
      onDestroy: () => {
        destroyed += 1;
      },
      execHandler: (argv): ExecResult => {
        const command = argv.join(" ");
        if (command.includes("git diff --cached --binary HEAD")) {
          events.push("patch");
          return {
            stdout: "diff --git a/file.py b/file.py\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (command.includes("/tests/test.sh")) {
          events.push("verify");
          return { stdout: "tests passed", stderr: "", exitCode: 0 };
        }
        if (command.includes("reward.txt")) {
          return { stdout: "1\n", stderr: "", exitCode: 0 };
        }
        if (command.includes("report.json")) {
          return {
            stdout: '{"resolved":true}\n',
            stderr: "",
            exitCode: 0,
          };
        }
        if (command.includes(`echo ${SUBMIT_SENTINEL}`)) {
          return { stdout: `${SUBMIT_SENTINEL}\n`, stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    const modelLayer = layerSucceed(
      ResponsesModel,
      ResponsesModel.of({
        generate: () =>
          succeed({
            outputItems: [
              {
                type: "function_call",
                id: "fc-1",
                call_id: "call-1",
                name: "bash",
                arguments: JSON.stringify({
                  command: `echo ${SUBMIT_SENTINEL}`,
                }),
              },
            ],
            functionCalls: [
              {
                callId: "call-1",
                name: "bash",
                arguments: JSON.stringify({
                  command: `echo ${SUBMIT_SENTINEL}`,
                }),
              },
            ],
            text: "done",
            usage: {
              inputTokens: 10,
              outputTokens: 2,
              totalTokens: 12,
              totalCost: 0,
            },
            generationTimeMs: 1,
          }),
      })
    );

    try {
      const result = await runSolver(modelLayer, sandboxLayer, taskDir);
      expect(events).toEqual(["patch", "upload:/tests", "verify"]);
      expect(destroyed).toBe(1);
      const meta = readSweBenchMeta(result.sample.metadata);
      expect(meta?.reward).toBe(1);
      expect(meta?.modelPatch).toContain("diff --git");
      expect(meta?.verifierReport).toBe('{"resolved":true}');
      const score = await runPromise(
        sweBenchScorer(result, result.sample.target)
      );
      expect(score.value).toBe(ScoreValue.Correct);
    } finally {
      rmSync(taskDir, { recursive: true, force: true });
    }
  });
});

async function runSolver(
  modelLayer: Layer<ResponsesModel>,
  sandboxLayer: Layer<SandboxSession>,
  taskDir: string
) {
  const solverLayer = effect(Solver)(
    gen(function* () {
      const model = yield* ResponsesModel;
      const sandbox = yield* SandboxSession;
      return Solver.of(
        makeSweBenchSolver(model, sandbox, {
          model: "test/model",
          apiKey: "test-key",
          stepLimit: 2,
        })
      );
    })
  );
  return runPromise(
    gen(function* () {
      const solver = yield* Solver;
      return yield* solver(initialTaskState(sample(taskDir)));
    }).pipe(
      provide(
        mergeAll(
          solverLayer.pipe(layerProvide(mergeAll(modelLayer, sandboxLayer))),
          noopProgressLayer,
          noopCheckpointLayer
        )
      )
    )
  );
}

function sample(taskDir: string): Sample {
  return {
    id: "swe_bench_verified-example",
    input: "Fix the bug.",
    target: { text: "example" },
    metadata: {
      taskId: "example",
      taskDir,
      dockerImage: "swebench/example:latest",
      maxAgentTimeoutSec: 3000,
      maxTestTimeoutSec: 3000,
      cpus: 1,
      memoryMb: 4096,
      storageMb: 10_240,
      allowInternet: true,
      category: "debugging",
      difficulty: "<15 min fix",
    },
  };
}

function makeTask(): string {
  const taskDir = mkdtempSync(join(tmpdir(), "swe-bench-solver-"));
  mkdirSync(join(taskDir, "environment"));
  mkdirSync(join(taskDir, "tests"));
  writeFileSync(
    join(taskDir, "task.toml"),
    `[task]
name = "swe-bench/swebench-verified__example"
description = "task"
[metadata]
category = "debugging"
difficulty = "<15 min fix"
[agent]
network_mode = "public"
timeout_sec = 3000
[verifier]
network_mode = "public"
timeout_sec = 3000
[environment]
cpus = 1
memory_mb = 4096
storage_mb = 10240
gpus = 0
`
  );
  writeFileSync(join(taskDir, "instruction.md"), "Fix the bug.");
  writeFileSync(
    join(taskDir, "environment/Dockerfile"),
    "FROM swebench/example:latest\nWORKDIR /testbed\nRUN mkdir -p /logs\n"
  );
  writeFileSync(join(taskDir, "tests/test.sh"), "#!/bin/bash\n");
  return taskDir;
}
