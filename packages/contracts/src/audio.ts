import { z } from "zod";

import { AssetSchema } from "./resources.js";

export const AudioCapabilityStatusSchema = z.enum(["AVAILABLE", "BLOCKED", "NOT_CONFIGURED"]);
export const AudioCapabilitySchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  status: AudioCapabilityStatusSchema,
  free: z.boolean(),
  key_required: z.boolean(),
  reason: z.string().max(240),
}).strict();

export const AudioCapabilitiesSchema = z.object({
  free_only: z.boolean(),
  capabilities: z.array(AudioCapabilitySchema).max(30),
  // Music assets are shared by every project in the authorized workspace.
  // Keep the list on the existing capability response so Studio can render
  // the same candidates that the production selector already consumes.
  music_assets: z.array(AssetSchema).default([]),
}).strict();

export type AudioCapabilityStatus = z.infer<typeof AudioCapabilityStatusSchema>;
export type AudioCapability = z.infer<typeof AudioCapabilitySchema>;
export type AudioCapabilities = z.infer<typeof AudioCapabilitiesSchema>;

// OpenMontage tools/audio/pixabay_music.py input contract, kept as a
// platform command for the explicitly restored source adapter.  It is used
// by the explicit import route and by the single AUTO/no-candidate fallback;
// the source defaults and bounds remain unchanged, while the platform only
// bounds the query length at the HTTP edge.
export const PixabayMusicImportCommandSchema = z.object({
  query: z.string().trim().min(1).max(200),
  min_duration: z.number().min(1).optional(),
  max_duration: z.number().max(600).optional(),
}).strict();

export const PixabayMusicTrackSchema = z.object({
  title: z.string().min(1).max(240),
  artist: z.string().min(1).max(160),
  duration_seconds: z.number().nonnegative().nullable(),
  pixabay_id: z.union([z.string(), z.number()]).nullable().optional(),
  results_found: z.number().int().nonnegative(),
  results_after_filter: z.number().int().nonnegative(),
}).strict();

export const PixabayMusicImportSchema = z.object({
  asset: AssetSchema,
  track: PixabayMusicTrackSchema,
}).strict();

export const PixabayMusicImportSuccessSchema = z.object({
  data: PixabayMusicImportSchema,
  request_id: z.string().min(1),
}).strict();

export type PixabayMusicImportCommand = z.infer<typeof PixabayMusicImportCommandSchema>;
export type PixabayMusicTrack = z.infer<typeof PixabayMusicTrackSchema>;
export type PixabayMusicImport = z.infer<typeof PixabayMusicImportSchema>;
