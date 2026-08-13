# C06 Provider Video Source Record

## Huobao media-tool probe

- Source: `upstream/huobao-drama/backend/src/utils/ffmpeg.ts`
- Fixed commit: `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`
- Borrowed intent: verify a bundled ffmpeg/ffprobe executable before use and fail closed when it is not executable.
- Local implementation: `src/media-validator.ts` and `src/mock-fixture.ts` use `createRequire` plus `spawn` directly, with a timeout and per-call temporary directory cleanup.
- Deliberate exclusions: no `fluent-ffmpeg`, global binary path mutation, `FFMPEG_BIN` fallback, poster/concat behavior, local media directory, Provider config, or upstream task state.
- Coverage: `tests/mock-provider.test.ts` and `tests/media-validator.test.ts` create only disposable fixture bytes and assert no external HTTP transport exists.

## Provider record boundary

- Source: `upstream/huobao-drama/backend/src/services/adapters/types.ts` (`VideoGenerationRecord`, `VideoProviderAdapter`) and `backend/src/services/generation.ts` (`processTask`, `pollTask`).
- Local implementation: `src/port.ts` retains only model/prompt/reference and submit/status/download phase intent. `src/mock-video-provider.ts` is a deterministic local implementation.
- Deliberate exclusions: direct Provider HTTP, global `AIConfig`, MySQL, process-local task truth, long-lived timers, real keys, and all upstream response shapes.
