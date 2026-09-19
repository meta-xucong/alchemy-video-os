ALTER TABLE "storyboard_shot_specs" ADD COLUMN "narrative_beat_sequences" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "storyboard_shot_specs"
SET "narrative_beat_sequences" = jsonb_build_array("sequence")
WHERE jsonb_array_length("narrative_beat_sequences") = 0;--> statement-breakpoint
ALTER TABLE "storyboard_shot_specs" ADD CONSTRAINT "storyboard_shot_specs_narrative_beats_nonempty_check" CHECK (jsonb_array_length("storyboard_shot_specs"."narrative_beat_sequences") > 0);
