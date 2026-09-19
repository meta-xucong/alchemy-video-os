ALTER TABLE "narration_asset_versions"
  ADD COLUMN "canonical_transcript_check" jsonb
  DEFAULT '{"status":"UNAVAILABLE","transcript_asset_id":null,"matches":null,"accuracy":null,"issues":["canonical transcript unavailable"]}'::jsonb
  NOT NULL;
ALTER TABLE "narration_asset_versions" ALTER COLUMN "canonical_transcript_check" DROP DEFAULT;
