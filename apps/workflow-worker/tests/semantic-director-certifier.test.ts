import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SemanticDirectorClientError,
  createSemanticDirectorRuntimeFromEnv,
} from "../src/semantic-director-client.js";
import { runSemanticDirectorCertification } from "../src/semantic-director-certifier.js";
import {
  parseSemanticDirectorCertificationReport,
  semanticDirectorCertificationBundle,
} from "../src/semantic-director-certification.js";

const segmentOneQuote = "冷白实验室中，两位研究员依次检查同一份护肤样本。";
const segmentTwoQuote = "第一阶段保持银白样本瓶与实验台的真实结构；第二阶段展示两人完成检查后的可见状态，不添加功效承诺。";

const rawPlanFixture = {
  execution_status: "READY" as const,
  segments: [
    {
      segment_id: "segment-1",
      duration_seconds: 15,
      visual_prompt: segmentOneQuote,
      dialogue_line_ids: ["line-2"],
      reference_asset_ids: semanticDirectorCertificationBundle.references.map((reference) => reference.asset_id),
    },
    {
      segment_id: "segment-2",
      duration_seconds: 15,
      visual_prompt: segmentTwoQuote,
      dialogue_line_ids: ["line-3"],
      reference_asset_ids: semanticDirectorCertificationBundle.references.map((reference) => reference.asset_id),
    },
  ],
  unresolved_items: [],
};

const certificationEnv = (): NodeJS.ProcessEnv => ({
  SEMANTIC_PLANNER_CERTIFY_LIVE: "true",
  SEMANTIC_PLANNER_CERTIFY_ATTEMPTS: "3",
  SEMANTIC_PLANNER_BASE_URL: "https://director.example.invalid/v1",
  SEMANTIC_PLANNER_API_KEY: "certification-secret-key",
  SEMANTIC_PLANNER_PROVIDER: "test-provider",
  SEMANTIC_PLANNER_MODEL: "test-model",
  SEMANTIC_PLANNER_PROFILE_ID: "test-candidate-profile",
  SEMANTIC_PLANNER_RESPONSE_MODE: "JSON_SCHEMA",
  SEMANTIC_PLANNER_TIMEOUT_MS: "1000",
  SEMANTIC_PLANNER_MAX_INPUT_UTF8_BYTES: "1000000",
  SEMANTIC_PLANNER_MAX_TOKENS: "8192",
});
test("certifier live guard fails before network and emits no credential", async () => {
  let fetchCalls = 0;
  const output: string[] = [];
  const result = await runSemanticDirectorCertification({
    argv: [],
    env: certificationEnv(),
    fetcher: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    },
    writeError: (line) => output.push(line),
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.code, "LIVE_GUARD");
  assert.equal(fetchCalls, 0);
  assert.equal(output.join("\n").includes("certification-secret-key"), false);
});

test("certifier requires every explicit candidate capability and at least three attempts", async () => {
  let fetchCalls = 0;
  const missingMode = certificationEnv();
  delete missingMode.SEMANTIC_PLANNER_RESPONSE_MODE;
  const missingModeResult = await runSemanticDirectorCertification({
    argv: ["--live"],
    env: missingMode,
    fetcher: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    },
    writeError: () => undefined,
  });
  assert.equal(missingModeResult.status, "FAILED");
  assert.equal(missingModeResult.code, "CONFIGURATION_INVALID");

  const tooFewAttempts = certificationEnv();
  tooFewAttempts.SEMANTIC_PLANNER_CERTIFY_ATTEMPTS = "2";
  const unstableResult = await runSemanticDirectorCertification({
    argv: ["--live"],
    env: tooFewAttempts,
    fetcher: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    },
    writeError: () => undefined,
  });
  assert.equal(unstableResult.status, "FAILED");
  assert.equal(unstableResult.code, "CONFIGURATION_INVALID");
  assert.equal(fetchCalls, 0);
});
test("certifier runs the fixed fixture repeatedly and returns only a hash-only candidate report", async () => {
  let fetchCalls = 0;
  const output: string[] = [];
  const result = await runSemanticDirectorCertification({
    argv: ["--live"],
    env: certificationEnv(),
    fetcher: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(rawPlanFixture) } }],
      }), { headers: { "content-type": "application/json" } });
    },
    writeOutput: (line) => output.push(line),
    writeError: (line) => output.push(line),
  });

  assert.equal(result.status, "CANDIDATE_PASS");
  assert.equal(fetchCalls, 3);
  if (result.status !== "CANDIDATE_PASS") return;
  assert.equal(result.attempts, 3);
  assert.equal(result.max_input_utf8_bytes, 1_000_000);
  assert.deepEqual(result.segment_counts, [2, 2, 2]);
  assert.equal(new Set(result.decision_hashes).size, 1);
  assert.deepEqual(result.dialogue_counts, [2, 2, 2]);
  assert.deepEqual(result.reference_usage_counts, [2, 2, 2]);
  const serialized = output.join("\n");
  assert.equal(serialized.includes("certification-secret-key"), false);
  assert.equal(serialized.includes(fixtureSourceForLeakCheck()), false);
  assert.equal(serialized.includes("director.example.invalid"), false);
});

test("certifier writes a safe local report only after full success and removes stale evidence before a failed run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "semantic-director-certification-"));
  const reportPath = join(directory, "candidate.semantic-director-certification.json");
  const env = {
    ...certificationEnv(),
    SEMANTIC_PLANNER_CERTIFICATION_REPORT_PATH: reportPath,
  };
  try {
    const passed = await runSemanticDirectorCertification({
      argv: ["--live"],
      env,
      fetcher: async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(rawPlanFixture) } }],
      }), { headers: { "content-type": "application/json" } }),
      writeOutput: () => undefined,
      writeError: () => undefined,
    });
    assert.equal(passed.status, "CANDIDATE_PASS");
    if (passed.status !== "CANDIDATE_PASS") return;
    const persisted = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
    assert.deepEqual(persisted, passed);
    assert.equal(new Set(passed.decision_hashes).size, 1);
    assert.equal(JSON.stringify(persisted).includes("certification-secret-key"), false);
    assert.equal(JSON.stringify(persisted).includes("director.example.invalid"), false);
    assert.equal(JSON.stringify(persisted).includes(fixtureSourceForLeakCheck()), false);

    const variedReport = structuredClone(passed);
    variedReport.decision_hashes = [
      passed.decision_hashes[0]!,
      "f".repeat(64),
      ...passed.decision_hashes.slice(2),
    ];
    variedReport.segment_counts = [1, 4, 15];
    assert.doesNotThrow(() => parseSemanticDirectorCertificationReport(variedReport));
    const malformedReport = structuredClone(passed);
    malformedReport.decision_hashes = [
      passed.decision_hashes[0]!,
      "g".repeat(64),
      ...passed.decision_hashes.slice(2),
    ];
    assert.throws(
      () => parseSemanticDirectorCertificationReport(malformedReport),
      { code: "CERTIFICATION_REPORT_INCOMPATIBLE" },
    );

    await writeFile(reportPath, "stale-report", "utf8");
    const failed = await runSemanticDirectorCertification({
      argv: ["--live"],
      env,
      fetcher: async () => new Response(JSON.stringify({
        choices: [{ message: { content: "```json\\n{}\\n```" } }],
      }), { headers: { "content-type": "application/json" } }),
      writeOutput: () => undefined,
      writeError: () => undefined,
    });
    assert.equal(failed.status, "FAILED");
    await assert.rejects(() => readFile(reportPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const fixtureSourceForLeakCheck = () => semanticDirectorCertificationBundle.source_text;
test("certifier never repairs Markdown or promotes a partial response", async () => {
  const output: string[] = [];
  const result = await runSemanticDirectorCertification({
    argv: ["--live"],
    env: { ...certificationEnv(), SEMANTIC_PLANNER_CERTIFY_ATTEMPTS: "3" },
    fetcher: async () => new Response(JSON.stringify({
      choices: [{ message: { content: "```json\n{}\n```" } }],
    }), { headers: { "content-type": "application/json" } }),
    writeError: (line) => output.push(line),
  });
  assert.equal(result.status, "FAILED");
  if (result.status !== "FAILED") return;
  assert.equal(result.code, "DIRECTOR_CONTENT_FORMAT_INVALID");
  assert.equal(result.attempt, 1);
  assert.equal(output.join("\n").includes("```json"), false);
});

test("certifier rejects platform-owned fields from a RawSemanticPlan response", async () => {
  const forbiddenBgmIntent = {
    ...structuredClone(rawPlanFixture),
    segments: rawPlanFixture.segments.map((segment, index) => index === 0
      ? { ...segment, bgm_intent: "warm cinematic piano" }
      : segment),
  };
  const result = await runSemanticDirectorCertification({
    argv: ["--live"],
    env: certificationEnv(),
    fetcher: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(forbiddenBgmIntent) } }],
    }), { headers: { "content-type": "application/json" } }),
    writeError: () => undefined,
  });
  assert.equal(result.status, "FAILED");
  if (result.status !== "FAILED") return;
  assert.equal(result.code, "CERTIFICATION_DECISION_SCHEMA_FAILED");
  assert.equal(result.stage, "SCHEMA");
  assert.deepEqual(result.validation_issue_codes, ["unrecognized_keys"]);
  assert.equal(result.attempt, 1);
});

test("certifier exposes only safe schema paths for cross-field canonicalization failures", async () => {
  const duplicateDialogue = structuredClone(rawPlanFixture);
  duplicateDialogue.segments[1]!.dialogue_line_ids = ["line-2"];
  const result = await runSemanticDirectorCertification({
    argv: ["--live"],
    env: certificationEnv(),
    fetcher: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(duplicateDialogue) } }],
    }), { headers: { "content-type": "application/json" } }),
    writeError: () => undefined,
  });
  assert.equal(result.status, "FAILED");
  if (result.status !== "FAILED") return;
  assert.equal(result.code, "CERTIFICATION_DECISION_SCHEMA_FAILED");
  assert.equal(result.stage, "SCHEMA");
  assert.deepEqual(result.validation_issue_codes, ["custom"]);
  assert.deepEqual(result.validation_issue_paths, ["dialogues"]);
});

test("certifier fails a structurally valid raw response that omits a reference from every segment", async () => {
  const partial = {
    ...structuredClone(rawPlanFixture),
    segments: rawPlanFixture.segments.map((segment) => ({
      ...segment,
      reference_asset_ids: [semanticDirectorCertificationBundle.references[0]!.asset_id],
    })),
  };
  const result = await runSemanticDirectorCertification({
    argv: ["--live"],
    env: { ...certificationEnv(), SEMANTIC_PLANNER_CERTIFY_ATTEMPTS: "3" },
    fetcher: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(partial) } }],
    }), { headers: { "content-type": "application/json" } }),
    writeError: () => undefined,
  });
  assert.equal(result.status, "FAILED");
  if (result.status !== "FAILED") return;
  assert.equal(result.code, "CERTIFICATION_SEGMENT_REFERENCE_COVERAGE_FAILED");
  assert.equal(result.attempt, 1);
});


test("certifier accepts valid editorial repartitioning across attempts", async () => {
  const threeSegments = {
    ...structuredClone(rawPlanFixture),
    segments: [
      { ...structuredClone(rawPlanFixture.segments[0]!), duration_seconds: 10 },
      { ...structuredClone(rawPlanFixture.segments[1]!), duration_seconds: 10 },
      {
        segment_id: "segment-3",
        duration_seconds: 10,
        visual_prompt: "Keep the final verified laboratory state visible without adding a claim.",
        dialogue_line_ids: [],
        reference_asset_ids: semanticDirectorCertificationBundle.references.map((reference) => reference.asset_id),
      },
    ],
  };
  let calls = 0;
  const result = await runSemanticDirectorCertification({
    argv: ["--live"],
    env: certificationEnv(),
    fetcher: async () => {
      calls += 1;
      const content = calls === 2 ? threeSegments : rawPlanFixture;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }), { headers: { "content-type": "application/json" } });
    },
    writeError: () => undefined,
  });
  assert.equal(result.status, "CANDIDATE_PASS");
  if (result.status !== "CANDIDATE_PASS") return;
  assert.deepEqual(result.segment_counts, [2, 3, 2]);
});

test("certifier rejects a segment reference order that is not canonical", async () => {
  const changedPlan = structuredClone(rawPlanFixture);
  changedPlan.segments[0]!.reference_asset_ids = [...changedPlan.segments[0]!.reference_asset_ids].reverse();
  let calls = 0;
  const result = await runSemanticDirectorCertification({
    argv: ["--live"],
    env: certificationEnv(),
    fetcher: async () => {
      calls += 1;
      const content = calls === 2 ? changedPlan : rawPlanFixture;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }), { headers: { "content-type": "application/json" } });
    },
    writeError: () => undefined,
  });
  assert.equal(result.status, "FAILED");
  if (result.status !== "FAILED") return;
  assert.equal(result.code, "CERTIFICATION_SEGMENT_REFERENCE_ORDER_FAILED");
  assert.equal(result.attempt, 2);
});

test("certifier rejects a plan whose segment durations do not total the requested target", async () => {
  const invalidDuration = structuredClone(rawPlanFixture);
  invalidDuration.segments[0]!.duration_seconds = 14;
  let calls = 0;
  const result = await runSemanticDirectorCertification({
    argv: ["--live"],
    env: certificationEnv(),
    fetcher: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(invalidDuration) } }],
      }), { headers: { "content-type": "application/json" } });
    },
    writeError: () => undefined,
  });
  assert.equal(result.status, "FAILED");
  if (result.status !== "FAILED") return;
  assert.equal(result.code, "CERTIFICATION_DECISION_SCHEMA_FAILED");
  assert.equal(result.stage, "SCHEMA");
  assert.equal(calls, 1);
});

test("certifier accepts creative prompt variation when executable structure is unchanged", async () => {
  const changedPrompt = structuredClone(rawPlanFixture);
  changedPrompt.segments[0]!.visual_prompt = segmentTwoQuote;
  let calls = 0;
  const result = await runSemanticDirectorCertification({
    argv: ["--live"],
    env: certificationEnv(),
    fetcher: async () => {
      calls += 1;
      const content = calls === 2 ? changedPrompt : rawPlanFixture;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }), { headers: { "content-type": "application/json" } });
    },
    writeError: () => undefined,
  });
  assert.equal(result.status, "CANDIDATE_PASS");
  if (result.status !== "CANDIDATE_PASS") return;
  assert.equal(calls, 3);
  assert.equal(new Set(result.decision_hashes).size, 1);
});

test("local reports require explicit non-production mode and current certification surface", async () => {
  const directory = await mkdtemp(join(tmpdir(), "semantic-director-runtime-report-"));
  const reportPath = join(directory, "candidate.semantic-director-certification.json");
  const certification = {
    ...certificationEnv(),
    SEMANTIC_PLANNER_CERTIFICATION_REPORT_PATH: reportPath,
  };
  try {
    const generated = await runSemanticDirectorCertification({
      argv: ["--live"],
      env: certification,
      fetcher: async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(rawPlanFixture) } }],
      }), { headers: { "content-type": "application/json" } }),
      writeOutput: () => undefined,
      writeError: () => undefined,
    });
    assert.equal(generated.status, "CANDIDATE_PASS");
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...certification,
      SEMANTIC_PLANNER_ENABLED: "true",
      SEMANTIC_PLANNER_ALLOW_LOCAL_CERTIFICATION_REPORT: "true",
      NODE_ENV: "test",
    };
    const runtime = createSemanticDirectorRuntimeFromEnv({ env: runtimeEnv });
    assert.equal(runtime.configuration.certification_source, "LOCAL_REPORT");
    if (generated.status === "CANDIDATE_PASS") {
      assert.equal(runtime.configuration.certification_surface_hash, generated.certification_surface_hash);
    }

    const unspecifiedEnvironment = { ...runtimeEnv };
    delete unspecifiedEnvironment.NODE_ENV;
    assert.throws(
      () => createSemanticDirectorRuntimeFromEnv({ env: unspecifiedEnvironment }),
      (error) => error instanceof SemanticDirectorClientError
        && error.code === "MODEL_PROFILE_UNAVAILABLE"
        && error.diagnostic?.error_class === "LOCAL_CERTIFICATION_REPORT_FORBIDDEN",
    );

    const tampered = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, unknown>;
    tampered.certification_surface_hash = "0".repeat(64);
    await writeFile(reportPath, `${JSON.stringify(tampered)}\n`, "utf8");
    assert.throws(
      () => createSemanticDirectorRuntimeFromEnv({ env: runtimeEnv }),
      (error) => error instanceof SemanticDirectorClientError
        && error.code === "MODEL_PROFILE_UNAVAILABLE",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
