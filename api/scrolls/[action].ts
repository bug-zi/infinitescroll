import type { VercelRequest, VercelResponse } from "@vercel/node";
import { calculatePurgeAfter } from "../_lib/scrollDeletion.js";
import { purgeScroll } from "../_lib/scrollPurge.js";
import { createSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { buildScrollUpdatePatch } from "../_lib/scrollUpdates.js";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { action } = request.query;
  const scrollId = String(request.body?.scrollId ?? "");
  if (!isUuid(scrollId)) {
    response.status(400).json({ error: "Invalid scrollId" });
    return;
  }

  try {
    const supabase = createSupabaseAdmin();

    switch (action) {
      case "delete": {
        const archivedAt = new Date().toISOString();
        const { error: scrollError } = await supabase
          .from("scrolls")
          .update({
            archived_at: archivedAt,
            purge_after: calculatePurgeAfter(archivedAt),
            auto_generation_enabled: false,
            status: "paused",
            updated_at: archivedAt,
          })
          .eq("id", scrollId);
        if (scrollError) throw scrollError;
        response.status(200).json({ ok: true, scrollId, archivedAt, purgeAfter: calculatePurgeAfter(archivedAt) });
        return;
      }
      case "restore": {
        const { error } = await supabase
          .from("scrolls")
          .update({
            archived_at: null,
            purge_after: null,
            auto_generation_enabled: true,
            status: "generating",
            updated_at: new Date().toISOString(),
          })
          .eq("id", scrollId);
        if (error) throw error;
        response.status(200).json({ ok: true, scrollId });
        return;
      }
      case "purge": {
        const result = await purgeScroll(supabase, scrollId);
        response.status(200).json({ ok: true, ...result });
        return;
      }
      case "update": {
        const patch = buildScrollUpdatePatch(request.body);
        const { data, error } = await supabase.from("scrolls").update(patch).eq("id", scrollId).select().single();
        if (error) throw error;
        response.status(200).json({ ok: true, scroll: data });
        return;
      }
      default:
        response.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : `${String(action)} scroll failed` });
  }
}
