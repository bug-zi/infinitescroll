import { getStoragePathFromPublicUrl } from "./scrollDeletion.js";

const IMAGE_BUCKET = "scroll-images";

type SupabaseLike = {
  from: (table: string) => any;
  storage: {
    from: (bucket: string) => any;
  };
};

export async function purgeScroll(supabase: SupabaseLike, scrollId: string) {
  const { data: images, error: imageLoadError } = await supabase.from("scroll_images").select("full_image_url").eq("scroll_id", scrollId);
  if (imageLoadError) throw imageLoadError;

  const storagePaths = (images ?? [])
    .map((image: { full_image_url?: string | null }) => getStoragePathFromPublicUrl(image.full_image_url, IMAGE_BUCKET))
    .filter(Boolean);

  if (storagePaths.length) {
    const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove(storagePaths);
    if (storageError) throw storageError;
  }

  for (const table of ["generation_jobs", "generation_logs", "scroll_images"]) {
    const { error } = await supabase.from(table).delete().eq("scroll_id", scrollId);
    if (error) throw error;
  }

  const { error: scrollError } = await supabase.from("scrolls").delete().eq("id", scrollId);
  if (scrollError) throw scrollError;

  return { scrollId, deletedImages: images?.length ?? 0 };
}

export async function purgeImage(supabase: SupabaseLike, imageId: string) {
  const { data: image, error: imageLoadError } = await supabase.from("scroll_images").select("full_image_url").eq("id", imageId).single();
  if (imageLoadError) throw imageLoadError;

  const storagePath = getStoragePathFromPublicUrl(image?.full_image_url, IMAGE_BUCKET);
  if (storagePath) {
    const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove([storagePath]);
    if (storageError) throw storageError;
  }

  const { error: deleteError } = await supabase.from("scroll_images").delete().eq("id", imageId);
  if (deleteError) throw deleteError;

  return { imageId, deletedImages: 1 };
}
