export async function persistGeneratedImageToSupabase({ supabase, bucket, scrollId, targetIndex, generated, now = Date.now }) {
  const storagePath = `scrolls/${scrollId}/${targetIndex}-${now()}.png`;
  const { error } = await supabase.storage.from(bucket).upload(storagePath, generated.bytes, {
    contentType: generated.mimeType ?? "image/png",
    upsert: true,
  });
  if (error) throw new Error(`Supabase Storage 上传失败：${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}
