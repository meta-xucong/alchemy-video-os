import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineEventHandler, createError } from "h3";

export default defineEventHandler(() => {
  if (process.env.LOCAL_AUTH_MODE !== "dev") throw createError({ statusCode: 404, statusMessage: "Not found" });
  const script = process.env.VIDEO_RELAY_RECONNECT_SCRIPT
    ?? resolve(process.cwd(), "../../.codex-longrun/local-acceptance/start-video-relay-tunnel.ps1");
  if (!existsSync(script)) throw createError({ statusCode: 503, statusMessage: "Relay reconnect is not configured" });
  const child = spawn("pwsh", ["-NoProfile", "-File", script], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return { data: { started: true } };
});
