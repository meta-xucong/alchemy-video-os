export type DisabledSub2ApiVideoProfile = Readonly<{
  provider: "sub2api";
  profile: "grok-imagine-video-1.5";
  model: "grok-imagine-video-1.5";
  enabled: false;
  inputModes: readonly [];
  durations: readonly [];
  resolutions: readonly [];
  ratios: readonly [];
  pollIntervalMs: 5000;
  maxPollAttempts: 120;
  disabledReason: "C07 offline protocol adapter has no live certification evidence.";
}>;

export type C07Sub2ApiCapabilitySnapshot = Readonly<{
  version: 1;
  provider: "sub2api";
  profiles: readonly DisabledSub2ApiVideoProfile[];
}>;

const disabledGrokProfile: DisabledSub2ApiVideoProfile = Object.freeze({
  provider: "sub2api",
  profile: "grok-imagine-video-1.5",
  model: "grok-imagine-video-1.5",
  enabled: false,
  inputModes: Object.freeze([]) as readonly [],
  durations: Object.freeze([]) as readonly [],
  resolutions: Object.freeze([]) as readonly [],
  ratios: Object.freeze([]) as readonly [],
  pollIntervalMs: 5000,
  maxPollAttempts: 120,
  disabledReason: "C07 offline protocol adapter has no live certification evidence.",
});

const snapshot: C07Sub2ApiCapabilitySnapshot = Object.freeze({
  version: 1,
  provider: "sub2api",
  profiles: Object.freeze([disabledGrokProfile]),
});

// This module is deliberately not re-exported by the package root or any public API.
export const getInternalC07Sub2ApiCapabilitySnapshot = (): C07Sub2ApiCapabilitySnapshot => snapshot;
