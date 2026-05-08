const DEFAULT_GENERATION_TIMEOUT_MS = 12 * 60 * 1000;

type TimeoutEnv = Partial<Pick<NodeJS.ProcessEnv, "GENERATION_TIMEOUT_MS" | "OPENAI_IMAGE_TIMEOUT_MS">>;

export function getImageRequestTimeoutMs(env: TimeoutEnv = process.env): number {
  const generationTimeoutMs = parsePositiveInteger(env.GENERATION_TIMEOUT_MS) ?? DEFAULT_GENERATION_TIMEOUT_MS;
  const configuredImageTimeoutMs = parsePositiveInteger(env.OPENAI_IMAGE_TIMEOUT_MS);
  return Math.max(generationTimeoutMs, configuredImageTimeoutMs ?? generationTimeoutMs);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}
