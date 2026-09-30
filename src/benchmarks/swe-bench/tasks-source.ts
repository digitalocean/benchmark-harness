import type { Dirent } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { parse as parseToml } from "smol-toml";

import type { SweBenchTask } from "./schema";
import { SweBenchTaskTomlSchema } from "./schema";

export const SWE_BENCH_TASKS_DIR_ENV = "BENCH_SWE_BENCH_TASKS_DIR";

export function resolveSweBenchTasksDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): string {
  const configured = env[SWE_BENCH_TASKS_DIR_ENV]?.trim();
  return resolve(cwd, configured || "datasets/swebench-verified");
}

function parseDockerfile(dockerfile: string, path: string) {
  const instructions = dockerfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const fromIndexes = instructions.flatMap((line, index) =>
    /^FROM\s+/i.test(line) ? [index] : []
  );
  const fromIndex = fromIndexes[0];
  if (fromIndexes.length !== 1 || fromIndex === undefined) {
    throw new Error(
      `${path} must contain exactly one FROM instruction; found ${fromIndexes.length}`
    );
  }
  const from = instructions[fromIndex];
  if (from === undefined) {
    throw new Error(`Missing FROM instruction in ${path}`);
  }
  const match = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+\S+)?$/i.exec(
    from
  );
  if (!match?.[1]) {
    throw new Error(`Unsupported FROM instruction in ${path}: ${from}`);
  }
  const buildSteps = instructions
    .slice(fromIndex + 1)
    .filter((line) => !/^WORKDIR\s+/i.test(line));
  return { dockerImage: match[1], imageBuildSteps: buildSteps };
}

export async function loadSweBenchTask(taskDir: string): Promise<SweBenchTask> {
  const taskTomlPath = resolve(taskDir, "task.toml");
  const dockerfilePath = resolve(taskDir, "environment/Dockerfile");
  const instructionPath = resolve(taskDir, "instruction.md");
  const testDir = resolve(taskDir, "tests");
  const [taskTomlText, dockerfile] = await Promise.all([
    readFile(taskTomlPath, "utf8"),
    readFile(dockerfilePath, "utf8"),
    access(instructionPath),
    stat(testDir).then((value) => {
      if (!value.isDirectory()) {
        throw new Error(`${testDir} is not a directory`);
      }
    }),
    access(resolve(testDir, "test.sh")),
  ]);
  const taskToml = SweBenchTaskTomlSchema.parse(parseToml(taskTomlText));
  const { dockerImage, imageBuildSteps } = parseDockerfile(
    dockerfile,
    dockerfilePath
  );

  return {
    id: taskToml.task.name.replace(/^swe-bench\/swebench-verified__/, ""),
    taskToml,
    taskDir,
    testDir,
    instructionPath,
    dockerImage,
    imageBuildSteps,
  };
}

export async function loadSweBenchTasks(
  tasksDir = resolveSweBenchTasksDir()
): Promise<readonly SweBenchTask[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(tasksDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Unable to read SWE-bench Verified tasks at ${tasksDir}. Set ${SWE_BENCH_TASKS_DIR_ENV} to the generated Harbor task directory.`,
      { cause: error }
    );
  }
  const taskDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(tasksDir, entry.name))
    .toSorted();
  if (taskDirs.length === 0) {
    throw new Error(
      `No SWE-bench Verified task directories found in ${tasksDir}`
    );
  }
  return Promise.all(taskDirs.map(loadSweBenchTask));
}
