export function getStoragePathFromPublicUrl(publicUrl: string | null | undefined, bucket: string) {
  if (!publicUrl || publicUrl.startsWith("/")) return null;

  const marker = `/storage/v1/object/public/${bucket}/`;
  const markerIndex = publicUrl.indexOf(marker);
  if (markerIndex === -1) return null;

  const pathWithQuery = publicUrl.slice(markerIndex + marker.length);
  const objectPath = pathWithQuery.split(/[?#]/, 1)[0];
  return objectPath ? decodeURIComponent(objectPath) : null;
}
