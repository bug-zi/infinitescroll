import type { VercelRequest, VercelResponse } from "@vercel/node";
import { draftScriptWithDeepSeek } from "../_lib/ai.js";
const SCRIPT_FRAME_COUNTS = [24, 48, 96, 128] as const;
const DEFAULT_SCRIPT_FRAME_COUNT = 48;
function normalizeFrameCount(value: unknown) {
  const count = Number(value);
  return SCRIPT_FRAME_COUNTS.includes(count as (typeof SCRIPT_FRAME_COUNTS)[number]) ? count : DEFAULT_SCRIPT_FRAME_COUNT;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const theme = typeof request.body?.theme === "string" ? request.body.theme.trim() : "";
    if (!theme) {
      response.status(400).json({ ok: false, error: "theme is required" });
      return;
    }

    const draft = await draftScriptWithDeepSeek({
      theme,
      frameCount: normalizeFrameCount(request.body?.frameCount),
      requirements: typeof request.body?.requirements === "string" ? request.body.requirements : "",
      stylePrompt: typeof request.body?.stylePrompt === "string" ? request.body.stylePrompt : "",
    });
    response.status(200).json({ ok: true, draft });
  } catch (error) {
    response.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Script draft failed" });
  }
}
