export function getStoragePathFromPublicUrl(publicUrl: string | null | undefined, bucket: string) {
  if (!publicUrl || publicUrl.startsWith("/")) return null;

  const marker = `/storage/v1/object/public/${bucket}/`;
  const markerIndex = publicUrl.indexOf(marker);
  if (markerIndex === -1) return null;

  const pathWithQuery = publicUrl.slice(markerIndex + marker.length);
  const objectPath = pathWithQuery.split(/[?#]/, 1)[0];
  return objectPath ? decodeURIComponent(objectPath) : null;
}

export function calculatePurgeAfter(archivedAtIso: string) {
  return new Date(Date.parse(archivedAtIso) + 7 * 24 * 60 * 60 * 1000).toISOString();
}
