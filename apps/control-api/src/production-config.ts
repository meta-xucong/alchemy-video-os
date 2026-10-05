/**
 * Commercial-mode startup guard.  This is deliberately a small, pure
 * validation surface so deployment preflight and unit tests use the same
 * fail-closed rules.  Local development remains unchanged when
 * COMMERCIAL_MODE is not exactly "true".
 */
export type CommercialConfig = Readonly<Record<string, string | undefined>>;

export const isCommercialFlagEnabled = (value: string | undefined) => value?.trim().toLowerCase() === "true";
const isPlaceholder = (value: string | undefined) => !value || /^<.+>$/.test(value.trim()) || value.trim().length < 32;

export const validateCommercialConfig = (env: CommercialConfig = process.env): string[] => {
  if (!isCommercialFlagEnabled(env.COMMERCIAL_MODE)) return [];
  const errors: string[] = [];
  if ((env.NODE_ENV ?? "").trim() !== "production") errors.push("NODE_ENV=production is required when COMMERCIAL_MODE=true.");
  if ((env.LOCAL_AUTH_MODE ?? "").trim().toLowerCase() === "dev") errors.push("LOCAL_AUTH_MODE=dev is forbidden when COMMERCIAL_MODE=true.");
  if (!isCommercialFlagEnabled(env.VEYRA_AUTH_ENABLED)) errors.push("VEYRA_AUTH_ENABLED=true is required when COMMERCIAL_MODE=true.");
  if (!isCommercialFlagEnabled(env.VEYRA_CREDIT_ENABLED)) errors.push("VEYRA_CREDIT_ENABLED=true is required when COMMERCIAL_MODE=true.");
  const provider = env.VIDEO_PROVIDER?.trim().toLowerCase();
  if (!provider || provider === "mock") errors.push("VIDEO_PROVIDER must be a certified real provider when COMMERCIAL_MODE=true.");
  if (provider && provider !== "mock" && env.VIDEO_PROVIDER_CERTIFIED !== "true") errors.push("VIDEO_PROVIDER_CERTIFIED=true is required after an independent provider capability certification.");
  if (provider === "sub2api") {
    if (!env.SUB2API_VIDEO_BASE_URL?.trim().startsWith("https://")) errors.push("SUB2API_VIDEO_BASE_URL must be an https:// URL when COMMERCIAL_MODE=true.");
  }
  if (env.LOCAL_AUTH_MODE && env.LOCAL_AUTH_MODE.trim().toLowerCase() !== "veyra") errors.push("LOCAL_AUTH_MODE must be veyra or unset when COMMERCIAL_MODE=true.");
  const edgeConfig = env.EDGE_NGINX_CONFIG?.trim().replaceAll("\\", "/").toLowerCase();
  if (!edgeConfig || !edgeConfig.endsWith("/nginx/video.aiself.vip.veyra.conf")) errors.push("EDGE_NGINX_CONFIG must select the reviewed Veyra TLS production configuration.");
  for (const name of ["VIDEO_SESSION_SECRET", "REFERENCE_DELIVERY_SIGNING_KEY", "MEDIA_RUNTIME_TOKEN", "VIDEO_VEYRA_INTERNAL_TOKEN"]) {
    if (isPlaceholder(env[name])) errors.push(`${name} must be a high-entropy deployment secret.`);
  }
  const sessionMaxAge = Number(env.VIDEO_SESSION_MAX_AGE_SECONDS ?? "");
  if (!Number.isSafeInteger(sessionMaxAge) || sessionMaxAge < 60 || sessionMaxAge > 3600) errors.push("VIDEO_SESSION_MAX_AGE_SECONDS must be between 60 and 3600 in commercial mode.");
  for (const name of ["VIDEO_VEYRA_INTERNAL_BASE_URL", "VIDEO_VEYRA_PORTAL_BASE_URL", "REFERENCE_DELIVERY_ORIGIN"]) {
    const value = env[name]?.trim();
    if (!value) errors.push(`${name} is required when COMMERCIAL_MODE=true.`);
    else if (!value.startsWith("https://")) errors.push(`${name} must use https:// when COMMERCIAL_MODE=true.`);
  }
  const corsOrigins = env.CONTROL_API_CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
  if (corsOrigins.length === 0 || corsOrigins.some((origin) => !origin.startsWith("https://"))) errors.push("CONTROL_API_CORS_ORIGINS must be a non-empty list of https:// origins in commercial mode.");
  return errors;
};

export const assertCommercialConfig = (env: CommercialConfig = process.env): void => {
  const errors = validateCommercialConfig(env);
  if (errors.length > 0) throw new Error(`Commercial startup blocked:\n- ${errors.join("\n- ")}`);
};
