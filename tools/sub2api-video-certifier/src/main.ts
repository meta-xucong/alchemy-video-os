import { fileURLToPath } from "node:url";

import { runCertification, createDefaultDependencies } from "./certifier.js";
import { parseCertifierArguments } from "./config.js";
import { createCertifierHttpsTransport, type LiveEnvironment } from "./live-transport.js";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));

const readLiveEnvironment = (): LiveEnvironment => ({
  baseUrl: process.env.SUB2API_VIDEO_BASE_URL ?? "",
  apiKey: process.env.SUB2API_VIDEO_API_KEY ?? "",
});

const main = async () => {
  try {
    const result = await runCertification(parseCertifierArguments(process.argv.slice(2)), {
      ...createDefaultDependencies(projectRoot),
      readLiveEnvironment,
      createTransport: (environment) => createCertifierHttpsTransport({ environment, fetcher: fetch }),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.outcome === "FAILED" ? 1 : 0;
  } catch {
    process.stdout.write('{"outcome":"FAILED"}\n');
    process.exitCode = 1;
  }
};

void main();
