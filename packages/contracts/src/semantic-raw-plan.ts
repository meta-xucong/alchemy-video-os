import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { AssetIdSchema } from "./primitives.js";

const RawSegmentIdSchema = z.string().regex(/^segment-[A-Za-z0-9_-]{1,95}$/);
const RawDialogueIdSchema = z.string().regex(/^line-[A-Za-z0-9_-]{1,95}$/);

/**
 * Model-owned semantic intent only.
 * Platform facts (hashes, evidence, provenance and canonical identities)
 * are deliberately excluded and generated after model output.
 */
export const RawSemanticPlanSchema = z.object({
  execution_status: z.enum(["READY", "BLOCKED"]),
  segments: z.array(z.object({
    segment_id: RawSegmentIdSchema,
    duration_seconds: z.number().int().positive().max(600),
    visual_prompt: z.string().min(1).max(4000),
    dialogue_line_ids: z.array(RawDialogueIdSchema).max(120),
    reference_asset_ids: z.array(AssetIdSchema).max(7),
  }).strict()).max(60),
  unresolved_items: z.array(z.string().min(1).max(1000)).max(64),
}).strict();

export const RawSemanticPlanJsonSchema = zodToJsonSchema(
  RawSemanticPlanSchema,
  {
    name: "RawSemanticPlan",
    target: "jsonSchema7",
    $refStrategy: "root",
  },
);

export type RawSemanticPlan = z.infer<typeof RawSemanticPlanSchema>;
