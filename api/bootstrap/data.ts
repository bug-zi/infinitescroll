import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { formatUnknownError } from "../../src/lib/errorFormatting.js";

export default async function handler(_request: VercelRequest, response: VercelResponse) {
  try {
    const supabase = createSupabaseAdmin();
    const [scrolls, images, jobs, logs] = await Promise.all([
      supabase.from("scrolls").select("*").order("created_at", { ascending: false }),
      supabase.from("scroll_images").select("*").order("image_index", { ascending: true }),
      supabase.from("generation_jobs").select("*").order("scheduled_for", { ascending: true }),
      supabase.from("generation_logs").select("*").order("created_at", { ascending: false }).limit(80),
    ]);

    const error = scrolls.error ?? images.error ?? jobs.error ?? logs.error;
    if (error) throw error;

    response.status(200).json({
      scrolls: scrolls.data ?? [],
      images: images.data ?? [],
      jobs: jobs.data ?? [],
      logs: logs.data ?? [],
    });
  } catch (error) {
    response.status(500).json({ error: formatUnknownError(error) });
  }
}
