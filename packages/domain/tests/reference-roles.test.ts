import assert from "node:assert/strict";
import test from "node:test";

import {
  inferVisualReferenceLockPolicies,
  inferVisualReferenceRoles,
  isVisualReferenceOnlyInstruction,
  isVisualReferenceRoleInstruction,
} from "../src/reference-roles.js";

test("user image-role instructions override visual analysis", () => {
  assert.deepEqual(
    inferVisualReferenceRoles({
      sourcePrompt: "第一张是度假别墅场景图，第二张是人物图，第三张补充风格。",
      count: 3,
      visionAnalyses: [
        { role: "SUBJECT", confidence: 0.98 },
        { role: "STYLE", confidence: 0.98 },
        { role: "SCENE", confidence: 0.98 },
      ],
    }),
    ["SCENE", "SUBJECT", "STYLE"],
  );
});

test("English and numbered image instructions are supported", () => {
  assert.deepEqual(
    inferVisualReferenceRoles({ sourcePrompt: "Image 1 is the product, image 2 is the background location.", count: 2 }),
    ["SUBJECT", "SCENE"],
  );
});

test("ambiguous or absent instructions remain unresolved without visual analysis", () => {
  assert.deepEqual(
    inferVisualReferenceRoles({ sourcePrompt: "请保持画面高级、统一、真实。", count: 3 }),
    [undefined, undefined, undefined],
  );
});

test("a single image can use an unnumbered user description", () => {
  assert.deepEqual(
    inferVisualReferenceRoles({ sourcePrompt: "这张上传的图片是场景建筑。", count: 1 }),
    ["SCENE"],
  );
});

test("single-image role instruction is isolated from later creative content", () => {
  assert.deepEqual(
    inferVisualReferenceRoles({
      sourcePrompt: "这张上传的图片仅用于风格参考，不作为开场画面。请保持场景稳定、物理结构连贯。",
      count: 1,
    }),
    ["STYLE"],
  );
});

test("visual analysis resolves roles when the user did not specify them", () => {
  assert.deepEqual(
    inferVisualReferenceRoles({
      sourcePrompt: "请保持人物和场景统一。",
      count: 3,
      visionAnalyses: [
        { role: "SCENE", confidence: 0.91 },
        { role: "SUBJECT", confidence: 0.88 },
        { role: "STYLE", confidence: 0.76 },
      ],
    }),
    ["SCENE", "SUBJECT", "STYLE"],
  );
});

test("low-confidence visual analysis remains unresolved", () => {
  assert.deepEqual(
    inferVisualReferenceRoles({
      sourcePrompt: "保持统一风格。",
      count: 1,
      visionAnalyses: [undefined],
    }),
    [undefined],
  );
});

test("explicit image-role guidance is identified without inferring upload order", () => {
  assert.equal(isVisualReferenceRoleInstruction("第一张图片为人物原型，第二张图片为场景，生成视频。"), true);
  assert.equal(isVisualReferenceRoleInstruction("她穿过庭院，抬头看向远处。"), false);
});

test("explicit filenames and remaining-image instructions resolve roles without upload-order inference", () => {
  assert.deepEqual(
    inferVisualReferenceRoles({
      sourcePrompt: "用上传图片中的人物.png为人物原型，上传的场景图场景.jpg为口播场地背景，其他几张图片为商业宣传片的场景参考。",
      count: 4,
      sourceImageNames: ["场景.jpg", "空镜1.jpg", "空镜2.jpg", "人物.png"],
    }),
    ["SCENE", "SCENE", "SCENE", "SUBJECT"],
  );
});

test("remaining visual-effect references resolve to STYLE", () => {
  assert.deepEqual(
    inferVisualReferenceRoles({
      sourcePrompt: "第一张图片为人物，其他几张图片为商业宣传片的视觉效果参考。",
      count: 3,
    }),
    ["SUBJECT", "STYLE", "STYLE"],
  );
});

test("UI reference instructions stay reference-only even when role is SUBJECT", () => {
  const sourcePrompt = "参考图用途说明：02.png 是产品界面主体参考；16.png 是场景环境参考；04.png 是视觉风格和配色参考；26.png 是视觉风格和配色参考。";
  const sourceImageNames = ["02.png", "16.png", "04.png", "26.png"];
  const roles = inferVisualReferenceRoles({
    sourcePrompt,
    count: sourceImageNames.length,
    sourceImageNames,
    // Deliberately conflict with the filename-specific instructions. The
    // authored purpose must win without changing the input order.
    visionAnalyses: sourceImageNames.map(() => ({ role: "SUBJECT" as const, confidence: 0.98 })),
  });
  assert.deepEqual(roles, ["SUBJECT", "SCENE", "STYLE", "STYLE"]);
  assert.equal(isVisualReferenceOnlyInstruction("参考图用途说明：02.png 是产品界面主体参考"), true);
  assert.deepEqual(inferVisualReferenceLockPolicies({ sourcePrompt, roles, sourceImageNames }), [
    "REFERENCE_ONLY",
    "REFERENCE_ONLY",
    "REFERENCE_ONLY",
    "REFERENCE_ONLY",
  ]);
});

test("explicit foreground reference instructions opt into the existing object-lock path", () => {
  const sourcePrompt = "第一张图片为人物原型，第二张图片为场景背景。";
  const roles = inferVisualReferenceRoles({ sourcePrompt, count: 2 });
  assert.deepEqual(inferVisualReferenceLockPolicies({ sourcePrompt, roles }), ["LOCK_OBJECTS", "REFERENCE_ONLY"]);
});

test("explicit foreground purpose wins over a conflicting visual-analysis role", () => {
  const sourcePrompt = "第一张图片为人物原型。";
  assert.deepEqual(inferVisualReferenceLockPolicies({
    sourcePrompt,
    roles: ["SCENE"],
  }), ["LOCK_OBJECTS"]);
});
