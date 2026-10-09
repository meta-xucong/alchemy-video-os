import assert from 'node:assert/strict';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = '/app';
const forbiddenRuntimePackages = new Set(['nuxt', 'node-forge', 'braces']);
const workspaceRoots = ['apps', 'packages', 'tools'];
const checkedDependencies = [];

for (const workspaceRoot of workspaceRoots) {
  const rootPath = path.join(root, workspaceRoot);
  for (const entry of await readdir(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = path.join(rootPath, entry.name, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    const parentUrl = pathToFileURL(
      path.join(path.dirname(packageJsonPath), '__runtime_probe__.mjs'),
    ).href;
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      try {
        const resolvedUrl = import.meta.resolve(dependency, parentUrl);
        if (resolvedUrl.startsWith('file:')) await lstat(fileURLToPath(resolvedUrl));
      } catch (error) {
        throw new Error(
          `Production dependency ${dependency} from ${manifest.name} is not resolvable: ${error.message}`,
          { cause: error },
        );
      }
      checkedDependencies.push(`${manifest.name}:${dependency}`);
    }
  }
}

assert.ok(checkedDependencies.length > 0, 'No workspace production dependencies were checked');

async function verifyDependencyTrees(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const stats = await lstat(entryPath);
    if (entry.name === 'node_modules' && stats.isDirectory()) {
      for (const packageEntry of await readdir(entryPath, { withFileTypes: true })) {
        assert.ok(
          !forbiddenRuntimePackages.has(packageEntry.name),
          `Build-only or vulnerable package remains in runtime image: ${path.join(entryPath, packageEntry.name)}`,
        );
      }
    }
    if (stats.isDirectory()) await verifyDependencyTrees(entryPath);
  }
}

await verifyDependencyTrees(root);
await readFile(path.join(root, 'apps/studio-web/.output/server/index.mjs'));
console.log(
  `Production image verified: ${checkedDependencies.length} direct dependencies resolve; Nuxt and audited vulnerable packages are absent.`,
);
