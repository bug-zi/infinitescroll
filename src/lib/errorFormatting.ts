export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== "object") return String(error);

  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  if (code && message) return `${code}: ${message}`;
  if (message) return message;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
