export async function persistGeneratedImageToSupabase({ supabase, bucket, scrollId, targetIndex, generated, now = Date.now }) {
  const storagePath = `scrolls/${scrollId}/${targetIndex}-${now()}.png`;
  const error = await uploadWithRetry(async () => {
    const result = await supabase.storage.from(bucket).upload(storagePath, generated.bytes, {
      contentType: generated.mimeType ?? "image/png",
      upsert: true,
    });
    return result.error;
  });
  if (error) throw new Error(`Supabase Storage 上传失败：${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function uploadWithRetry(upload, maxAttempts = 2) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastError = await upload();
    if (!lastError) return null;
    if (!isRetryableStorageError(lastError) || attempt === maxAttempts) return lastError;
    await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
  }
  return lastError;
}

function isRetryableStorageError(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("aborted") || message.includes("timeout") || message.includes("fetch failed") || message.includes("network");
}
