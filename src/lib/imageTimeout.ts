const DEFAULT_GENERATION_TIMEOUT_MS = 12 * 60 * 1000;
const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 4 * 60 * 1000;
const DEFAULT_IMAGE_EDIT_REQUEST_TIMEOUT_MS = 45 * 1000;
const CUSTOM_GATEWAY_HEADROOM_MS = 60 * 1000;

type TimeoutEnv = Partial<
  Pick<NodeJS.ProcessEnv, "GENERATION_TIMEOUT_MS" | "OPENAI_IMAGE_TIMEOUT_MS" | "OPENAI_IMAGE_EDIT_TIMEOUT_MS" | "OPENAI_BASE_URL">
>;

export function getImageRequestTimeoutMs(env: TimeoutEnv = process.env): number {
  const generationTimeoutMs = parsePositiveInteger(env.GENERATION_TIMEOUT_MS) ?? DEFAULT_GENERATION_TIMEOUT_MS;
  const configuredImageTimeoutMs = parsePositiveInteger(env.OPENAI_IMAGE_TIMEOUT_MS);
  const defaultImageTimeoutMs = isCustomOpenAICompatibleBaseUrl(env.OPENAI_BASE_URL)
    ? Math.max(60 * 1000, generationTimeoutMs - CUSTOM_GATEWAY_HEADROOM_MS)
    : DEFAULT_IMAGE_REQUEST_TIMEOUT_MS;
  return Math.min(generationTimeoutMs, configuredImageTimeoutMs ?? defaultImageTimeoutMs);
}

export function getImageEditRequestTimeoutMs(env: TimeoutEnv = process.env): number {
  const imageRequestTimeoutMs = getImageRequestTimeoutMs(env);
  const configuredEditTimeoutMs = parsePositiveInteger(env.OPENAI_IMAGE_EDIT_TIMEOUT_MS);
  const defaultEditTimeoutMs = isCustomOpenAICompatibleBaseUrl(env.OPENAI_BASE_URL) ? imageRequestTimeoutMs : DEFAULT_IMAGE_EDIT_REQUEST_TIMEOUT_MS;
  return Math.min(imageRequestTimeoutMs, configuredEditTimeoutMs ?? defaultEditTimeoutMs);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function isCustomOpenAICompatibleBaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname !== "api.openai.com" && !hostname.endsWith(".openai.com");
  } catch {
    return false;
  }
}
