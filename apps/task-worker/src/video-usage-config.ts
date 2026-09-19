/**
 * The usage lookup account is deployment configuration, not a public task
 * field. A shared Sub2API video key settles usage under this account; when
 * omitted, the worker keeps the per-user lookup behavior.
 */
export const parseSub2ApiVideoUsageUserId = (raw: string | undefined): number | undefined => {
  if (!raw?.trim()) return undefined;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("SUB2API_VIDEO_USAGE_USER_ID must be a positive safe integer.");
  }
  return value;
};
