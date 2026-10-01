export const DIGITALOCEAN_INFERENCE_BASE_URLS = [
  "https://inference.do-ai.run/v1",
  "https://inference.do-ai-test.run/v1",
] as const;

export const DEFAULT_DIGITALOCEAN_INFERENCE_BASE_URL =
  DIGITALOCEAN_INFERENCE_BASE_URLS[0];

function withoutTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, "");
}

export function isDigitalOceanInferenceBaseUrl(value: string): boolean {
  const normalized = withoutTrailingSlashes(value);
  return DIGITALOCEAN_INFERENCE_BASE_URLS.some(
    (baseUrl) => baseUrl === normalized
  );
}
