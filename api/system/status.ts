import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { buildSystemStatusFromRows } from "../_lib/systemStatus.js";
import { formatUnknownError } from "../../src/lib/errorFormatting.js";

export default async function handler(_request: VercelRequest, response: VercelResponse) {
  try {
    const supabase = createSupabaseAdmin();
    const [scrolls, images, jobs] = await Promise.all([
      supabase.from("scrolls").select("id,auto_generation_enabled,next_run_at"),
      supabase.from("scroll_images").select("id,generated_at"),
      supabase.from("generation_jobs").select("id,status"),
    ]);
    const error = scrolls.error ?? images.error ?? jobs.error;
    if (error) throw error;

    response.status(200).json(
      buildSystemStatusFromRows({
        scrolls: scrolls.data ?? [],
        images: images.data ?? [],
        jobs: jobs.data ?? [],
        maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2),
      }),
    );
  } catch (error) {
    response.status(500).json({
      ...buildSystemStatusFromRows({
        scrolls: [],
        images: [],
        jobs: [],
        maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2),
        statusError: formatUnknownError(error),
      }),
    });
  }
}
