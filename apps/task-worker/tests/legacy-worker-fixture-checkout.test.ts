import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const repositoryRoot = new URL("../../../", import.meta.url);
const fixturePath = "apps/task-worker/tests/fixtures/legacy-worker-44da842";
const fixtureRoot = new URL(`${fixturePath}/`, repositoryRoot);
const legacyCommit = "44da8428d2c1b73648eb1616cd0350dac798eba8";
type Fixture = { source: string; sha256: string; bytes: Buffer };

const assertOriginalBytes = (bytes: Buffer, fixture: Pick<Fixture, "source" | "sha256">) => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256, fixture.source);
};

const readFixtures = async (): Promise<Fixture[]> => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", fixtureRoot), "utf8")) as {
    commit: string;
    files: Array<{ source: string; sha256: string }>;
  };
  assert.equal(manifest.commit, legacyCommit);
  assert.equal(manifest.files.length, 8);
  return Promise.all(manifest.files.map(async (file) => {
    const bytes = await readFile(new URL(file.source, fixtureRoot));
    assertOriginalBytes(bytes, file);
    assert.ok(bytes.includes(0x0a), file.source);
    assert.equal(bytes.includes(0x0d), false, file.source);
    return { ...file, bytes };
  }));
};

test("pinned legacy Worker bytes survive Git checkout with core.autocrlf=true", async (t) => {
  const fixtures = await readFixtures();
  const attributes = await readFile(new URL(".gitattributes", repositoryRoot));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "legacy-worker-checkout-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const emptyConfig = join(temporaryRoot, "empty-config");
  await writeFile(emptyConfig, "");
  // An isolated index and raw blobs exercise real Git checkout conversion,
  // without changing this checkout, creating a commit, or needing Git history.
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyConfig,
  };

  for (const withAttributes of [false, true]) {
    const checkoutRoot = join(temporaryRoot, withAttributes ? "protected" : "unprotected");
    await mkdir(checkoutRoot);
    const git = (args: string[], input?: Buffer) => execFileSync("git", [
      "-c", "core.autocrlf=true",
      "-c", "core.eol=crlf",
      "-c", `core.attributesFile=${emptyConfig}`,
      ...args,
    ], { cwd: checkoutRoot, env, input, stdio: ["pipe", "pipe", "pipe"] });
    git(["init", "--quiet", "--template="]);
    const stageBytes = (path: string, bytes: Buffer) => {
      const blob = git(["hash-object", "-w", "--stdin"], bytes).toString("utf8").trim();
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
    };
    if (withAttributes) stageBytes(".gitattributes", attributes);
    for (const fixture of fixtures) stageBytes(`${fixturePath}/${fixture.source}`, fixture.bytes);

    git(["checkout-index", "--all"]);
    for (const fixture of fixtures) {
      const bytes = await readFile(join(checkoutRoot, fixturePath, fixture.source));
      if (withAttributes) {
        assert.deepEqual(bytes, fixture.bytes, fixture.source);
        assertOriginalBytes(bytes, fixture);
      } else {
        // Prove the test really enables Windows-style conversion: removing the
        // repository attributes must reproduce the original hash mismatch.
        assert.deepEqual(bytes, Buffer.from(fixture.bytes.toString("utf8").replaceAll("\n", "\r\n")), fixture.source);
        assert.throws(() => assertOriginalBytes(bytes, fixture), { code: "ERR_ASSERTION" });
      }
    }
  }
});

test("raw legacy Worker hashes reject content and line-ending byte mutations", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "legacy-worker-mutation-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  for (const fixture of await readFixtures()) {
    const fixtureCopy = join(temporaryRoot, fixture.source);
    await mkdir(dirname(fixtureCopy), { recursive: true });
    const mutations = [
      Buffer.from(fixture.bytes),
      Buffer.from(fixture.bytes.toString("utf8").replaceAll("\n", "\r\n")),
    ];
    mutations[0][0] ^= 1;
    for (const mutation of mutations) {
      await writeFile(fixtureCopy, mutation);
      const bytes = await readFile(fixtureCopy);
      assert.throws(() => assertOriginalBytes(bytes, fixture), { code: "ERR_ASSERTION" });
    }
  }
});
