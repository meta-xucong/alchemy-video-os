import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = resolve(appRoot, ".output/server/index.mjs");

const build = spawnSync(process.execPath, ["./node_modules/nuxt/bin/nuxt.mjs", "build"], {
  cwd: appRoot,
  stdio: "inherit"
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

process.env.HOST ??= "127.0.0.1";
process.env.PORT ??= "3031";

await import(pathToFileURL(serverEntry).href);
