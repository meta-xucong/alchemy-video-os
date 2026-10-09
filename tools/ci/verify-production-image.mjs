import assert from 'node:assert/strict';
import { lstat, realpath, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = '/app';
const forbiddenRuntimePackages = new Set(['nuxt', 'node-forge', 'braces']);
const workspaceRoots = ['apps', 'packages', 'tools'];
const checkedDependencies = [];
const resolvedWorkspaceDependencies = [];
const installedPackages = new Map();
const verifiedWorkerModules = [];
let verifiedMediaTools;
let dependencyProbeSequence = 0;

async function verifyWorkspaceImports(packageJsonPath, packageName, dependencies) {
  if (dependencies.length === 0) return [];
  const probePath = path.join(
    path.dirname(packageJsonPath),
    `.runtime-dependency-probe-${process.pid}-${dependencyProbeSequence++}.mjs`,
  );
  const source = `
    import { lstat, realpath, readFile } from 'node:fs/promises';
    import path from 'node:path';
    import { fileURLToPath } from 'node:url';
    const workspace = ${JSON.stringify(packageName)};
    export const resolutions = [];
    for (const dependency of ${JSON.stringify(dependencies)}) {
      const resolvedUrl = import.meta.resolve(dependency);
      if (resolvedUrl.startsWith('file:')) await lstat(fileURLToPath(resolvedUrl));
      const installedPath = await realpath(
        fileURLToPath(new URL('./node_modules/' + dependency, import.meta.url)),
      );
      const installedManifest = JSON.parse(
        await readFile(path.join(installedPath, 'package.json'), 'utf8'),
      );
      resolutions.push({
        workspace,
        requestedName: dependency,
        name: installedManifest.name,
        version: installedManifest.version,
        entry: resolvedUrl,
      });
    }
  `;

  await writeFile(probePath, source, { flag: 'wx' });
  try {
    const result = await import(pathToFileURL(probePath).href);
    resolvedWorkspaceDependencies.push(...result.resolutions);
    return result.resolutions;
  } catch (error) {
    throw new Error(
      `Production ESM dependency verification failed for ${packageName}: ${error.message}`,
      { cause: error },
    );
  } finally {
    await rm(probePath, { force: true });
  }
}

async function recordInstalledPackage(packagePath) {
  try {
    const realPackagePath = await realpath(packagePath);
    const manifest = JSON.parse(
      await readFile(path.join(realPackagePath, 'package.json'), 'utf8'),
    );
    if (manifest.name && manifest.version) {
      installedPackages.set(realPackagePath, {
        name: manifest.name,
        version: manifest.version,
        path: path.relative(root, realPackagePath),
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }
}

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

    const dependencies = Object.keys(manifest.dependencies ?? {});
    await verifyWorkspaceImports(packageJsonPath, manifest.name, dependencies);
    for (const dependency of dependencies) checkedDependencies.push(`${manifest.name}:${dependency}`);
  }
}

const standaloneOutputDirectory = path.join(root, 'apps/studio-web/.output/server');
const standaloneManifestPath = path.join(standaloneOutputDirectory, 'package.json');
const standaloneManifest = JSON.parse(await readFile(standaloneManifestPath, 'utf8'));
const standaloneRuntimeDependencyVersions = standaloneManifest.dependencies ?? {};
const standaloneRuntimeDependencies = Object.keys(standaloneRuntimeDependencyVersions);
const standaloneNodeModulesDirectory = path.join(standaloneOutputDirectory, 'node_modules');
for (const dependency of standaloneRuntimeDependencies) {
  const dependencyDirectory = path.join(standaloneNodeModulesDirectory, dependency);
  const dependencyRealPath = await realpath(dependencyDirectory);
  const dependencyRelativePath = path.relative(
    standaloneNodeModulesDirectory,
    dependencyRealPath,
  );
  assert.ok(
    dependencyRelativePath !== '..' &&
      !dependencyRelativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(dependencyRelativePath),
    `Standalone Studio dependency ${dependency} escapes its own node_modules tree`,
  );
  const installedManifest = JSON.parse(
    await readFile(path.join(dependencyRealPath, 'package.json'), 'utf8'),
  );
  assert.equal(
    installedManifest.version,
    standaloneRuntimeDependencyVersions[dependency],
    `Standalone Studio expects ${dependency}@${standaloneRuntimeDependencyVersions[dependency]}, found ${installedManifest.version}`,
  );
  resolvedWorkspaceDependencies.push({
    workspace: '@alchemy-video/studio-web .output/server',
    requestedName: dependency,
    name: installedManifest.name,
    version: installedManifest.version,
    entry: path.join(dependencyRealPath, 'package.json'),
  });
}

const standaloneImportsByDirectory = new Map();
const standaloneImportPattern =
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const isStandalonePackageSpecifier = (specifier) =>
  !(
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    /^(?:node|data|file):/.test(specifier)
  );

async function collectStandaloneImports(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectStandaloneImports(entryPath);
      continue;
    }
    if (!/\.(?:mjs|js|cjs)$/.test(entry.name)) continue;
    const source = await readFile(entryPath, 'utf8');
    const imports = standaloneImportsByDirectory.get(path.dirname(entryPath)) ?? new Set();
    for (const match of source.matchAll(standaloneImportPattern)) {
      if (isStandalonePackageSpecifier(match[1])) imports.add(match[1]);
    }
    if (imports.size > 0) standaloneImportsByDirectory.set(path.dirname(entryPath), imports);
  }
}

await collectStandaloneImports(standaloneOutputDirectory);
const standaloneDependencyNames = new Set(standaloneRuntimeDependencies);
for (const [sourceDirectory, importSpecifiers] of standaloneImportsByDirectory) {
  for (const specifier of importSpecifiers) {
    const segments = specifier.split('/');
    const packageName = specifier.startsWith('@')
      ? segments.slice(0, 2).join('/')
      : segments[0];
    assert.ok(
      standaloneDependencyNames.has(packageName),
      `Standalone import ${specifier} is absent from its generated dependency manifest`,
    );
  }
  const probePath = path.join(
    sourceDirectory,
    `.runtime-dependency-probe-${process.pid}-${dependencyProbeSequence++}.mjs`,
  );
  const probeSource = `
    import assert from 'node:assert/strict';
    import { lstat, realpath } from 'node:fs/promises';
    import path from 'node:path';
    import { fileURLToPath } from 'node:url';
    const runtimeNodeModules = ${JSON.stringify(standaloneNodeModulesDirectory)};
    for (const specifier of ${JSON.stringify([...importSpecifiers])}) {
      const resolvedUrl = import.meta.resolve(specifier);
      assert.ok(
        resolvedUrl.startsWith('file:'),
        'Standalone import did not resolve to a file: ' + specifier,
      );
      const resolvedPath = fileURLToPath(resolvedUrl);
      await lstat(resolvedPath);
      const realResolvedPath = await realpath(resolvedPath);
      const relativePath = path.relative(runtimeNodeModules, realResolvedPath);
      assert.ok(
        relativePath !== '..' &&
          !relativePath.startsWith('..' + path.sep) &&
          !path.isAbsolute(relativePath),
        'Standalone import ' + specifier + ' escaped its own node_modules tree to ' + realResolvedPath,
      );
    }
  `;
  await writeFile(probePath, probeSource, { flag: 'wx' });
  try {
    await import(pathToFileURL(probePath).href);
  } catch (error) {
    throw new Error(
      `Standalone Studio emitted-import verification failed from ${sourceDirectory}: ${error.message}`,
      { cause: error },
    );
  } finally {
    await rm(probePath, { force: true });
  }
}
checkedDependencies.push(
  ...standaloneRuntimeDependencies.map((dependency) => `@alchemy-video/studio-web .output/server:${dependency}`),
);

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
        if (packageEntry.name.startsWith('@') && packageEntry.isDirectory()) {
          for (const scopedPackage of await readdir(path.join(entryPath, packageEntry.name))) {
            await recordInstalledPackage(
              path.join(entryPath, packageEntry.name, scopedPackage),
            );
          }
        } else {
          await recordInstalledPackage(path.join(entryPath, packageEntry.name));
        }
      }
    }
    if (stats.isDirectory()) await verifyDependencyTrees(entryPath);
  }
}

await verifyDependencyTrees(root);
await readFile(path.join(root, 'apps/studio-web/.output/server/index.mjs'));

const providerVideoValidator = await import(
  pathToFileURL(path.join(root, 'packages/provider-video/dist/media-validator.js')).href,
);
verifiedMediaTools = await providerVideoValidator.verifyBundledMediaTools();

for (const modulePath of [
  'apps/task-worker/dist/execution-service.js',
  'apps/task-worker/dist/billing-executor.js',
]) {
  await import(pathToFileURL(path.join(root, modulePath)).href);
  verifiedWorkerModules.push(modulePath);
}

assert.equal(
  checkedDependencies.length,
  resolvedWorkspaceDependencies.length,
  'Not every declared workspace production dependency was ESM-resolved',
);

console.log(JSON.stringify({
  directProductionDependencyCount: checkedDependencies.length,
  installedPackageCount: installedPackages.size,
  verifiedWorkerModules,
  verifiedMediaTools,
  absentPackages: [...forbiddenRuntimePackages].sort(),
}));
