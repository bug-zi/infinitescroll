import type { VercelRequest, VercelResponse } from "@vercel/node";
import { draftScriptWithDeepSeek } from "../_lib/ai.js";
import { normalizeFrameCount } from "../../src/lib/scriptDraft.js";

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
