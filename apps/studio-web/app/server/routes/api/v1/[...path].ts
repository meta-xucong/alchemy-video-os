import { defineEventHandler } from "h3";

import { proxyControlApiRequest, resolveControlApiOrigin } from "../../../utils/control-api-proxy.mjs";

export default defineEventHandler((event) => {
  const runtimeConfig = useRuntimeConfig(event);
  const controlApiOrigin = resolveControlApiOrigin(runtimeConfig.controlApiOrigin);

  return proxyControlApiRequest(event, controlApiOrigin);
});
