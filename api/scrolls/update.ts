import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildScrollUpdatePatch } from "../_lib/scrollUpdates";
import { createSupabaseAdmin } from "../_lib/supabaseAdmin";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const scrollId = String(request.body?.scrollId ?? "");
  if (!isUuid(scrollId)) {
    response.status(400).json({ error: "Invalid scrollId" });
    return;
  }

  try {
    const supabase = createSupabaseAdmin();
    const patch = buildScrollUpdatePatch(request.body);
    const { data, error } = await supabase.from("scrolls").update(patch).eq("id", scrollId).select().single();
    if (error) throw error;

    response.status(200).json({ ok: true, scroll: data });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Update scroll failed",
    });
  }
}
