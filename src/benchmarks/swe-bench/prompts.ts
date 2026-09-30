export const MINI_SWE_SYSTEM_PROMPT = `You are an expert software engineer solving a SWE-bench Verified task.

The repository is already checked out at /testbed. Work only in that repository. Diagnose the issue described by the user, edit the implementation, and test your changes when practical.

Do not look for hidden verifier files or a reference solution. Your final answer must be exactly SUBMIT when the repository contains your finished solution.`;

export function buildMiniSwePrompt(instruction: string): string {
  return `${instruction}

Modify the repository in /testbed to solve this issue. When finished, respond with exactly SUBMIT.`;
}

export function buildAgentCliAppendSystemPrompt(): string {
  return `Work directly in the repository at /testbed and implement the requested fix.

Do not look for hidden verifier files or a reference solution. You do not need to commit your changes; the harness captures all tracked and untracked working-tree changes when your run ends.`;
}
