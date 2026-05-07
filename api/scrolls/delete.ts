import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStoragePathFromPublicUrl } from "../_lib/scrollDeletion";
import { createSupabaseAdmin } from "../_lib/supabaseAdmin";

const IMAGE_BUCKET = "scroll-images";

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
    const { data: images, error: imageLoadError } = await supabase.from("scroll_images").select("full_image_url").eq("scroll_id", scrollId);
    if (imageLoadError) throw imageLoadError;

    const storagePaths = (images ?? [])
      .map((image) => getStoragePathFromPublicUrl(image.full_image_url, IMAGE_BUCKET))
      .filter((value): value is string => Boolean(value));
    if (storagePaths.length) {
      const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove(storagePaths);
      if (storageError) throw storageError;
    }

    const tables = ["generation_jobs", "generation_logs", "scroll_images"];
    for (const table of tables) {
      const { error } = await supabase.from(table).delete().eq("scroll_id", scrollId);
      if (error) throw error;
    }

    const { error: scrollError } = await supabase.from("scrolls").delete().eq("id", scrollId);
    if (scrollError) throw scrollError;

    response.status(200).json({ ok: true, scrollId, deletedImages: images?.length ?? 0 });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Delete scroll failed",
    });
  }
}
