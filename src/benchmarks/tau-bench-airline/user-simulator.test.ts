import { describe, expect, it } from "bun:test";

import { fail, flatMap, map, runPromise, succeed } from "effect/Effect";

import { ModelError } from "../../harness/core";
import type {
  ResponsesInputItem,
  ResponsesModelService,
  ResponsesTurn,
} from "../../providers/responses-model";
import {
  getCollectedGenerationIdEntries,
  recordGenerationId,
  resetGenerationIds,
} from "../../runtime/generation-ids";
import { UserSimulator } from "./user-simulator";

const config = {
  apiKey: "sk-test",
  model: "openai/gpt-5",
  fallbackModel: "openai-gpt-5-fallback",
  sessionId: "session-1",
  reasoningEffort: "medium",
} as const;
const runLevelReasoningEffort = "low";

function modelFor(
  turns: readonly ResponsesTurn[],
  inputs: ResponsesInputItem[][]
): ResponsesModelService {
  let index = 0;
  return {
    generate: (input, options) => {
      inputs.push([...input]);
      expect(options.reasoningEffort).toBe(config.reasoningEffort);
      expect(options.reasoningEffort).not.toBe(runLevelReasoningEffort);
      return succeed(turns[Math.min(index++, turns.length - 1)]!);
    },
  };
}

describe("tau-bench airline user simulator", () => {
  it("uses Responses turns and replays output items", async () => {
    const inputs: ResponsesInputItem[][] = [];
    const responseItems = [
      { type: "reasoning", encrypted_content: "opaque" },
      { type: "message", content: [{ type: "output_text", text: "Hello" }] },
    ];
    const model = modelFor(
      [
        {
          outputItems: responseItems,
          functionCalls: [],
          text: "Hello",
          generationTimeMs: 1,
        },
        {
          outputItems: [],
          functionCalls: [],
          text: "Goodbye",
          generationTimeMs: 1,
        },
      ],
      inputs
    );
    const simulator = new UserSimulator(model, config);
    simulator.reset("scenario", "Hi");

    expect(await runPromise(simulator.generateInitial())).toBe("Hello");
    expect(await runPromise(simulator.step("How are you?"))).toBe("Goodbye");
    expect(inputs[1]).toEqual([
      { type: "message", role: "system", content: expect.any(String) },
      { type: "message", role: "user", content: "Hi" },
      ...responseItems,
      { type: "message", role: "user", content: "How are you?" },
    ]);
  });

  it("uses the configured fallback model", async () => {
    const requestedModels: string[] = [];
    const model: ResponsesModelService = {
      generate: (_input, options) => {
        requestedModels.push(options.model ?? "");
        return requestedModels.length === 1
          ? fail(new ModelError({ message: "primary failed" }))
          : succeed({
              outputItems: [],
              functionCalls: [],
              text: "Fallback response",
              generationTimeMs: 1,
            });
      },
    };
    const simulator = new UserSimulator(model, config);
    simulator.reset("scenario", "Hi");

    expect(await runPromise(simulator.generateInitial())).toBe(
      "Fallback response"
    );
    expect(requestedModels).toEqual([config.model, config.fallbackModel]);
  });

  it("marks user-model generations as auxiliary usage", async () => {
    const model: ResponsesModelService = {
      generate: () =>
        recordGenerationId("user-generation").pipe(
          map(() => ({
            outputItems: [],
            functionCalls: [],
            text: "Hello",
            generationTimeMs: 1,
          }))
        ),
    };
    const simulator = new UserSimulator(model, config);
    simulator.reset("scenario", "Hi");

    const entries = await runPromise(
      resetGenerationIds.pipe(
        flatMap(() => simulator.generateInitial()),
        flatMap(() => getCollectedGenerationIdEntries)
      )
    );
    expect(entries).toEqual([
      {
        id: "user-generation",
        isCacheHit: false,
        countsTowardUsage: false,
        isResolvedSource: false,
      },
    ]);
  });
});
