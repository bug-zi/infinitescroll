import { calculatePurgeAfter } from "./scrollDeletion.js";

type SupabaseLike = {
  from: (table: string) => any;
};

export async function archiveImage(supabase: SupabaseLike, imageId: string) {
  const archivedAt = new Date().toISOString();
  const purgeAfter = calculatePurgeAfter(archivedAt);
  const { data: image, error: imageError } = await supabase.from("scroll_images").select("scroll_id,image_index").eq("id", imageId).single();
  if (imageError) throw imageError;

  const { error } = await supabase
    .from("scroll_images")
    .update({ archived_at: archivedAt, purge_after: purgeAfter })
    .eq("id", imageId);
  if (error) throw error;

  return { imageId, scrollId: image.scroll_id, imageIndex: image.image_index, archivedAt, purgeAfter };
}

export async function restoreImage(supabase: SupabaseLike, imageId: string) {
  const { data: image, error: imageError } = await supabase.from("scroll_images").select("scroll_id,image_index").eq("id", imageId).single();
  if (imageError) throw imageError;

  const { error } = await supabase
    .from("scroll_images")
    .update({ archived_at: null, purge_after: null })
    .eq("id", imageId);
  if (error) throw error;

  return { imageId, scrollId: image.scroll_id, imageIndex: image.image_index };
}
