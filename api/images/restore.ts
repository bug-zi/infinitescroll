import type { VercelRequest, VercelResponse } from "@vercel/node";
import { restoreImage } from "../_lib/imageArchive.js";
import { createSupabaseAdmin } from "../_lib/supabaseAdmin.js";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const imageId = String(request.body?.imageId ?? "");
  if (!isUuid(imageId)) {
    response.status(400).json({ error: "Invalid imageId" });
    return;
  }

  try {
    const result = await restoreImage(createSupabaseAdmin(), imageId);
    response.status(200).json({ ok: true, ...result });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Restore image failed" });
  }
}
