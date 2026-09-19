import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  createLocalCapabilitySnapshot,
  writeLocalCapabilitySnapshot,
} from "./capability-snapshot.js";
import { createDefaultDependencies } from "./certifier.js";
import type { CertificationReport } from "./report.js";

const main = async () => {
  const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const dependencies = createDefaultDependencies(projectRoot);
  const entries = await readdir(dependencies.paths.reportsDirectory);
  const reports = await Promise.all(entries.filter((entry) => entry.endsWith(".json"))
    .map(async (entry) => JSON.parse(await readFile(join(dependencies.paths.reportsDirectory, entry), "utf8")) as CertificationReport));
  const successful = reports.filter((report) => report.outcome === "SUCCEEDED");
  if (successful.length !== 1) throw new Error("expected exactly one successful C08 report");
  const snapshot = createLocalCapabilitySnapshot(successful[0]);
  await writeLocalCapabilitySnapshot(dependencies.paths, snapshot);
  process.stdout.write('{"outcome":"CAPABILITY_SNAPSHOT_RECORDED"}\n');
};

void main().catch(() => {
  process.stdout.write('{"outcome":"CAPABILITY_SNAPSHOT_FAILED"}\n');
  process.exitCode = 1;
});
