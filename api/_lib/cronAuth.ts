export function isCronRequestAuthorized(authorizationHeader: string | string[] | undefined, cronSecret = process.env.CRON_SECRET) {
  if (!cronSecret) return true;
  const value = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  return value === `Bearer ${cronSecret}`;
}
