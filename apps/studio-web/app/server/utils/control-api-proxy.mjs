import { getRequestURL, proxyRequest } from "h3";

export const DEFAULT_CONTROL_API_ORIGIN = "http://127.0.0.1:3032";

export const resolveControlApiOrigin = (runtimeOrigin, environment = process.env) => {
  const configuredOrigin = environment.CONTROL_API_ORIGIN ?? runtimeOrigin ?? DEFAULT_CONTROL_API_ORIGIN;
  return new URL(configuredOrigin).origin;
};

export const proxyControlApiRequest = (event, controlApiOrigin) => {
  const requestUrl = getRequestURL(event);
  const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, `${controlApiOrigin}/`);

  return proxyRequest(event, target.toString());
};
