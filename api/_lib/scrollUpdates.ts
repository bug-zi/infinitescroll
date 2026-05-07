type ScrollUpdateBody = {
  title?: unknown;
  originalTheme?: unknown;
  optimizedPrompt?: unknown;
  autoGenerationEnabled?: unknown;
};

export function buildScrollUpdatePatch(body: ScrollUpdateBody, nowIso = new Date().toISOString()) {
  const patch: Record<string, string | boolean> = { updated_at: nowIso };

  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.originalTheme === "string" && body.originalTheme.trim()) patch.original_theme = body.originalTheme.trim();
  if (typeof body.optimizedPrompt === "string") patch.optimized_prompt = body.optimizedPrompt.trim();
  if (typeof body.autoGenerationEnabled === "boolean") {
    patch.auto_generation_enabled = body.autoGenerationEnabled;
    patch.status = body.autoGenerationEnabled ? "generating" : "paused";
  }

  return patch;
}
