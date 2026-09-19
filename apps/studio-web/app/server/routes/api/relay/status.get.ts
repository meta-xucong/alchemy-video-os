import { defineEventHandler } from "h3";

const invalidTokenPath = "/provider-input/health-check-invalid-token";

export default defineEventHandler(async () => {
  const origin = process.env.REFERENCE_DELIVERY_ORIGIN?.trim();
  const checkedAt = new Date().toISOString();
  const reconnectAvailable = process.env.LOCAL_AUTH_MODE === "dev" && Boolean(process.env.POLYMARKET_SSH_PASSPHRASE);
  if (!origin) return { data: { state: "unavailable", checked_at: checkedAt, reconnect_available: reconnectAvailable } };
  try {
    const response = await fetch(new URL(invalidTokenPath, origin), {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    // An invalid token must be rejected by Control API. 404 therefore proves
    // the HTTPS edge and reverse tunnel are reachable without exposing a token.
    const state = response.status === 404 ? "connected" : "disconnected";
    return { data: { state, checked_at: checkedAt, reconnect_available: reconnectAvailable } };
  } catch {
    return { data: { state: "disconnected", checked_at: checkedAt, reconnect_available: reconnectAvailable } };
  }
});
