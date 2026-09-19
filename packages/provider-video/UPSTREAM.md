# C06-C07 Provider Video Source Record

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

## C07 SUB2API offline protocol adapter

- Protocol source: `https://github.com/meta-xucong/sub2api-video-mcp`, fixed commit `3f2d885b79630f50b9cf4ae62251596cc37bbd18`.
- Huobao boundary source: `upstream/huobao-drama/backend/src/services/adapters/types.ts` (`VideoProviderAdapter`, `VideoGenerationRecord`) and `backend/src/services/generation.ts` (submit/poll responsibility split), fixed commit `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`.
- Local implementation: `src/sub2api/mapper.ts`, `transport.ts`, `adapter.ts`, `errors.ts`, and internal-only `capabilities.ts`. The retained protocol is exactly `POST /videos/generations`, `GET /videos/{id}`, `GET /videos/{id}/content`, plus `model`, `prompt`, `duration`, `resolution`, `ratio`, `image.image_url`, `id`/`request_id`, and `status`/`state` compatibility. Download returns the stream with actual `Content-Type` and optional parsed `Content-Length` for the C06 validator.
- Local modifications: `Sub2ApiVideoProvider` requires a caller-injected `Sub2ApiTransport`; C07 supplies neither a default HTTP/fetch transport nor configuration, base URL, headers, credentials, Key lookup, polling timer, task persistence, Worker/API/Studio registration, or public capability endpoint. C07's `referenceImageUrl` is an execution-only server parameter and is not a TaskRun, event, database, or public API field.
- Capability boundary: `capabilities.ts` exposes only an immutable internal C07 snapshot. The documented Grok candidate is fixed `enabled: false`; Seedance model and capability values are omitted until C08 live certification. The capability module is intentionally absent from the package root export map and public contracts.
- Deliberate exclusions: the MCP server/tools, its process-local state, direct requests, environment variables, `Authorization`/Bearer/Cookie headers, signed URLs, object keys, Veyra/credit behavior, real response captures, media binaries, real certification, and profile enablement.
- Local failure boundary: `VideoProviderFailure` carries `code`, `retryable`, and `stage`; Sub2API rejected submit/download errors preserve that type for C06. Missing/invalid download MIME and non-retryable 404 are `DOWNLOAD_INVALID`; temporary 503 remains retryable. C06 uses the returned MIME/length before SHA-256/ffprobe and never defaults a real adapter response to `video/mp4`.
- Coverage: `tests/sub2api-mapper.test.ts`, `sub2api-transport.test.ts`, `sub2api-adapter.contract.test.ts`, and `sub2api-capabilities.test.ts` cover CONTRACT-001 through CONTRACT-008, metadata propagation, explicit transport injection, blocked global fetch fallback, structural protocol errors, synthetic fixture redaction, immutable disabled snapshots, and absence from package/public/Studio exports. `apps/task-worker/tests/execution-service.test.ts` covers the cross-package rejected/404/wrong-MIME/length-mismatch/503 recovery semantics.
