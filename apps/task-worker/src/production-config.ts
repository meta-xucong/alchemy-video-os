export const isCommercialWorkerModeEnabled = (value: string | undefined) => value?.trim().toLowerCase() === "true";

export const assertCommercialWorkerConfig = (env: NodeJS.ProcessEnv = process.env) => {
  if (!isCommercialWorkerModeEnabled(env.COMMERCIAL_MODE)) return;
  const provider = env.VIDEO_PROVIDER?.trim().toLowerCase();
  const errors: string[] = [];
  if (!provider || provider === "mock") errors.push("VIDEO_PROVIDER must not be mock in commercial mode.");
  if (env.VIDEO_PROVIDER_CERTIFIED !== "true") errors.push("VIDEO_PROVIDER_CERTIFIED=true is required for the task worker.");
  if (env.VEYRA_CREDIT_ENABLED !== "true") errors.push("VEYRA_CREDIT_ENABLED=true is required for commercial task execution.");
  if (provider === "sub2api") {
    if (!env.SUB2API_VIDEO_BASE_URL?.startsWith("https://")) errors.push("SUB2API_VIDEO_BASE_URL must use HTTPS.");
    const key = env.SUB2API_VIDEO_API_KEY?.trim();
    if (!key || key.length < 32 || /^<.+>$/.test(key)) errors.push("SUB2API_VIDEO_API_KEY is required in the task worker.");
  }
  if (errors.length > 0) throw new Error(`Commercial worker startup blocked:\n- ${errors.join("\n- ")}`);
};
