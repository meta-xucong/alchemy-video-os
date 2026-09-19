import { defineEventHandler } from "h3";

import { proxyControlApiRequest, resolveControlApiOrigin } from "../../utils/control-api-proxy.mjs";

// AISelf's Portal posts the one-time Video ticket to /auth/veyra/callback and
// the Studio sends logout to /auth/logout.  Keep both browser-facing routes on
// the same relative-origin proxy as /api/v1; the browser never sees Control
// API's private origin.
export default defineEventHandler((event) => {
  const runtimeConfig = useRuntimeConfig(event);
  const controlApiOrigin = resolveControlApiOrigin(runtimeConfig.controlApiOrigin);
  return proxyControlApiRequest(event, controlApiOrigin);
});
