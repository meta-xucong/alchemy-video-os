import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "../..");
const require = createRequire(import.meta.url);

test("Drizzle generates and checks the real schema without the retired esbuild-kit dependency chain", {
  timeout: 60_000,
}, async (t) => {
  const kitRoot = dirname(require.resolve("drizzle-kit"));
  const kitManifest = JSON.parse(await readFile(join(kitRoot, "package.json"), "utf8"));
  const kitRequire = createRequire(join(kitRoot, "package.json"));
  // This local dependency removal is reviewed for this exact published Kit version.
  assert.equal(kitManifest.version, "0.31.10");
  assert.equal(kitRequire("esbuild").version, "0.25.12");

  for (const dependency of ["@esbuild-kit/esm-loader", "@esbuild-kit/core-utils"]) {
    for (const resolver of [require, kitRequire]) {
      assert.throws(() => resolver.resolve(dependency), { code: "MODULE_NOT_FOUND" });
    }
  }
  const installedPackages = await readdir(join(workspaceRoot, "node_modules/.pnpm"));
  assert.deepEqual(installedPackages.filter((name) => (
    name.startsWith("@esbuild-kit+")
    || /^(?:esbuild|@esbuild\+[^@]+)@0\.18\.20(?:_|$)/u.test(name)
  )), []);

  const rootManifest = JSON.parse(await readFile(join(workspaceRoot, "package.json"), "utf8"));
  assert.equal(rootManifest.pnpm.overrides["drizzle-kit@0.31.10>@esbuild-kit/esm-loader"], "-");

  const temporaryRoot = await mkdtemp(join(packageRoot, ".drizzle-toolchain-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  // Freeze the schema for all comparisons while preserving its workspace imports.
  await writeFile(join(temporaryRoot, "schema.ts"), await readFile(join(packageRoot, "src/schema.ts")));
  const schemaPath = relative(packageRoot, join(temporaryRoot, "schema.ts")).split(sep).join("/");
  const bin = join(kitRoot, kitManifest.bin["drizzle-kit"]);
  const run = (command: string, config: string) => {
    const result = spawnSync(process.execPath, [bin, command, "--config", config], {
      cwd: packageRoot,
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  };
  const generatedSql: string[] = [];
  for (const label of ["first", "second"]) {
    const out = join(temporaryRoot, label);
    const outputPath = relative(packageRoot, out).split(sep).join("/");
    const config = join(temporaryRoot, `${label}.config.ts`);
    await writeFile(config, [
      'import baseConfig from "../drizzle.config.ts";',
      `export default { ...baseConfig, schema: ${JSON.stringify(schemaPath)}, out: ${JSON.stringify(outputPath)} };`,
      "",
    ].join("\n"));
    run("generate", config);
    run("check", config);
    const sqlFiles = (await readdir(out)).filter((name) => name.endsWith(".sql"));
    assert.equal(sqlFiles.length, 1);
    const sql = await readFile(join(out, sqlFiles[0]!), "utf8");
    assert.match(sql, /CREATE TABLE "task_runs"/u);
    assert.match(sql, /CREATE TABLE "provider_attempts"/u);
    generatedSql.push(sql);
    const journalPath = join(out, "meta/_journal.json");
    const journalBefore = await readFile(journalPath, "utf8");
    run("generate", config);
    assert.deepEqual((await readdir(out)).filter((name) => name.endsWith(".sql")), sqlFiles);
    assert.equal(await readFile(join(out, sqlFiles[0]!), "utf8"), sql);
    assert.equal(await readFile(journalPath, "utf8"), journalBefore);
  }
  assert.equal(generatedSql[0], generatedSql[1]);
});
