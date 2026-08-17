import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = process.env.STUDIO_NITRO_OUTPUT_DIR ?? resolve(appRoot, ".output");
const serverEntry = resolve(outputDirectory, "server", "index.mjs");

const build = spawnSync(process.execPath, ["./node_modules/nuxt/bin/nuxt.mjs", "build"], {
  cwd: appRoot,
  stdio: "inherit"
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

process.env.HOST ??= "127.0.0.1";
process.env.PORT ??= "3031";
if (!process.env.NITRO_CONTROL_API_ORIGIN && process.env.CONTROL_API_ORIGIN) {
  process.env.NITRO_CONTROL_API_ORIGIN = process.env.CONTROL_API_ORIGIN;
}

await import(pathToFileURL(serverEntry).href);
