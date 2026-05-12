import type { VercelRequest, VercelResponse } from "@vercel/node";
import { optimizeThemeWithDeepSeek } from "../_lib/ai.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const theme = String(req.body?.theme ?? "").trim();
    if (!theme) {
      res.status(400).json({ ok: false, error: "theme is required" });
      return;
    }

    const requirements = typeof req.body?.requirements === "string" ? req.body.requirements.trim() : "";
    const optimizedPrompt = await optimizeThemeWithDeepSeek(theme, requirements);
    res.status(200).json({ ok: true, optimizedPrompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prompt optimization failed";
    res.status(500).json({ ok: false, error: message });
  }
}
