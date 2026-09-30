import { describe, expect, it } from "bun:test";

import {
  isDigitalOceanInferenceBaseUrl,
  isOpenRouterInferenceBaseUrl,
  makeModelCatalogClient,
  ModelCatalogError,
} from "./model-catalog";

describe("DigitalOcean model catalog", () => {
  it("fetches every page, includes every provider, and sorts newest first", async () => {
    const urls: URL[] = [];
    const client = makeModelCatalogClient({
      env: { DO_MODEL_CATALOG_TOKEN: "catalog-token" },
      fetch: async (input, init) => {
        urls.push(new URL(String(input)));
        expect(init?.headers).toEqual({
          Authorization: "Bearer catalog-token",
        });
        const page = urls.at(-1)?.searchParams.get("page");
        return Response.json(
          page === "1"
            ? {
                data: [
                  {
                    model_id: "third-party",
                    provider: "MODEL_PROVIDER_OPENAI",
                    created_at: "2026-08-03T00:00:00Z",
                  },
                  {
                    model_id: "older-do",
                    created_at: "2026-08-01T00:00:00Z",
                  },
                ],
                meta: { page: 1, pages: 2 },
              }
            : {
                data: [
                  {
                    model_id: "newer-do",
                    provider: "MODEL_PROVIDER_DIGITALOCEAN",
                    created_at: "2026-08-02T00:00:00Z",
                  },
                  {
                    model_id: "older-do",
                    provider: "MODEL_PROVIDER_DIGITALOCEAN",
                    created_at: "2026-08-01T00:00:00Z",
                  },
                ],
                meta: { page: 2, pages: 2 },
              }
        );
      },
    });

    await expect(client.listDigitalOceanModels()).resolves.toEqual([
      "third-party",
      "newer-do",
      "older-do",
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[0]?.searchParams.get("per_page")).toBe("200");
    expect(urls[0]?.searchParams.get("sort_by")).toBe(
      "MODEL_CATALOG_SORT_BY_CREATED_AT"
    );
    expect(urls[0]?.searchParams.get("sort_direction")).toBe(
      "SORT_DIRECTION_DESC"
    );
  });

  it("rejects requests without a catalog token", async () => {
    const client = makeModelCatalogClient({ env: {} });

    await expect(client.listDigitalOceanModels()).rejects.toBeInstanceOf(
      ModelCatalogError
    );
  });

  it("loads all OpenRouter models newest first", async () => {
    const urls: URL[] = [];
    let currentTime = 0;
    const client = makeModelCatalogClient({
      env: { OPENROUTER_MODEL_CATALOG_TOKEN: "openrouter-token" },
      now: () => currentTime,
      fetch: async (input, init) => {
        urls.push(new URL(String(input)));
        expect(init?.headers).toEqual({
          Authorization: "Bearer openrouter-token",
        });
        return Response.json({
          data: [
            { id: "openai/newest", created: 300 },
            { id: "digitalocean/older", created: 100 },
            { id: "digitalocean/newer", created: 200 },
          ],
        });
      },
    });

    await expect(client.listOpenRouterModels()).resolves.toEqual([
      "openai/newest",
      "digitalocean/newer",
      "digitalocean/older",
    ]);
    currentTime = 2 * 60 * 60 * 1000 - 1;
    await expect(client.listOpenRouterModels()).resolves.toEqual([
      "openai/newest",
      "digitalocean/newer",
      "digitalocean/older",
    ]);
    expect(urls).toHaveLength(1);
    currentTime += 1;
    await client.listOpenRouterModels();
    expect(urls).toHaveLength(2);
    expect(urls[0]?.searchParams.has("providers")).toBe(false);
  });

  it("recognizes only the supported DigitalOcean inference endpoints", () => {
    expect(
      isDigitalOceanInferenceBaseUrl("https://inference.do-ai.run/v1")
    ).toBe(true);
    expect(
      isDigitalOceanInferenceBaseUrl("https://inference.do-ai-test.run/v1")
    ).toBe(true);
    expect(
      isDigitalOceanInferenceBaseUrl("https://inference.example.com/v1")
    ).toBe(false);
    expect(isOpenRouterInferenceBaseUrl("https://openrouter.ai/api/v1")).toBe(
      true
    );
  });
});
