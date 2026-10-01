import { Either } from "../internal/either";
import { firstZodIssueMessage, parseSchema, z } from "../internal/zod";

export {
  DIGITALOCEAN_INFERENCE_BASE_URLS,
  isDigitalOceanInferenceBaseUrl,
} from "../providers/digitalocean-inference";
export const OPENROUTER_INFERENCE_BASE_URL = "https://openrouter.ai/api/v1";

const CATALOG_URL = "https://api.digitalocean.com/v2/gen-ai/models/catalog";
const OPENROUTER_CATALOG_URL = "https://openrouter.ai/api/v1/models";
const CATALOG_CACHE_MS = 5 * 60 * 1000;
const OPENROUTER_CATALOG_CACHE_MS = 2 * 60 * 60 * 1000;

const ModelCatalogPageSchema = z.object({
  data: z.array(
    z.object({
      model_id: z.string().min(1),
      provider: z.string().optional(),
      created_at: z.iso.datetime().optional(),
    })
  ),
  meta: z.object({
    page: z.number().int().positive(),
    pages: z.number().int().positive(),
  }),
});

type ModelCatalogPage = z.infer<typeof ModelCatalogPageSchema>;

const OpenRouterCatalogSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      created: z.number().finite(),
    })
  ),
});

export class ModelCatalogError extends Error {
  override readonly name = "ModelCatalogError";
}

export interface ModelCatalogClient {
  readonly listDigitalOceanModels: () => Promise<readonly string[]>;
  readonly listOpenRouterModels: () => Promise<readonly string[]>;
}

function catalogToken(env: NodeJS.ProcessEnv): string {
  const token = env["DO_MODEL_CATALOG_TOKEN"]?.trim();
  if (token === undefined || token.length === 0) {
    throw new ModelCatalogError(
      "Model catalog is unavailable: set DO_MODEL_CATALOG_TOKEN with genai:read"
    );
  }
  return token;
}

function openRouterCatalogToken(env: NodeJS.ProcessEnv): string {
  const token = env["OPENROUTER_MODEL_CATALOG_TOKEN"]?.trim();
  if (token === undefined || token.length === 0) {
    throw new ModelCatalogError(
      "OpenRouter model catalog is unavailable: set OPENROUTER_MODEL_CATALOG_TOKEN"
    );
  }
  return token;
}

function timestamp(value: string | undefined): number {
  return value === undefined ? Number.NEGATIVE_INFINITY : Date.parse(value);
}

export function isOpenRouterInferenceBaseUrl(value: string): boolean {
  return value === OPENROUTER_INFERENCE_BASE_URL;
}

export function makeModelCatalogClient(
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly fetch?: typeof fetch;
    readonly now?: () => number;
  } = {}
): ModelCatalogClient {
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached:
    | { readonly expiresAt: number; readonly models: readonly string[] }
    | undefined;
  let openRouterCached:
    | { readonly expiresAt: number; readonly models: readonly string[] }
    | undefined;

  async function fetchPage(
    token: string,
    page: number
  ): Promise<ModelCatalogPage> {
    const url = new URL(CATALOG_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "200");
    url.searchParams.set("sort_by", "MODEL_CATALOG_SORT_BY_CREATED_AT");
    url.searchParams.set("sort_direction", "SORT_DIRECTION_DESC");
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new ModelCatalogError(
        `DigitalOcean model catalog request failed with HTTP ${response.status}`
      );
    }
    const parsed = parseSchema(ModelCatalogPageSchema, body);
    if (Either.isLeft(parsed)) {
      throw new ModelCatalogError(
        `DigitalOcean model catalog response was invalid: ${firstZodIssueMessage(parsed.left)}`
      );
    }
    return parsed.right;
  }

  async function fetchOpenRouterModels(): Promise<readonly string[]> {
    if (openRouterCached !== undefined && openRouterCached.expiresAt > now()) {
      return openRouterCached.models;
    }
    const url = new URL(OPENROUTER_CATALOG_URL);
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${openRouterCatalogToken(env)}` },
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new ModelCatalogError(
        `OpenRouter model catalog request failed with HTTP ${response.status}`
      );
    }
    const parsed = parseSchema(OpenRouterCatalogSchema, body);
    if (Either.isLeft(parsed)) {
      throw new ModelCatalogError(
        `OpenRouter model catalog response was invalid: ${firstZodIssueMessage(parsed.left)}`
      );
    }
    const models = parsed.right.data
      .sort((a, b) => b.created - a.created)
      .map(({ id }) => id)
      .filter((modelId, index, all) => all.indexOf(modelId) === index);
    openRouterCached = {
      models,
      expiresAt: now() + OPENROUTER_CATALOG_CACHE_MS,
    };
    return models;
  }

  return {
    listDigitalOceanModels: async () => {
      if (cached !== undefined && cached.expiresAt > now()) {
        return cached.models;
      }
      const token = catalogToken(env);
      const firstPage = await fetchPage(token, 1);
      const pages = [firstPage];
      for (let page = 2; page <= firstPage.meta.pages; page += 1) {
        pages.push(await fetchPage(token, page));
      }
      const models = pages
        .flatMap(({ data }) => data)
        .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at))
        .map(({ model_id: modelId }) => modelId)
        .filter((modelId, index, all) => all.indexOf(modelId) === index);
      cached = { models, expiresAt: now() + CATALOG_CACHE_MS };
      return models;
    },
    listOpenRouterModels: fetchOpenRouterModels,
  };
}
