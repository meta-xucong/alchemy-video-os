# Upstream Migration Record

## C04 Storage Boundary

No upstream repository supplies a reusable, workspace-scoped S3 storage adapter. This package is a platform-owned S3-compatible port built on the AWS SDK so that MinIO and a future S3 deployment share the same isolated boundary.

| Target | Source | Retained convention | Platform adaptation | Regression coverage |
| --- | --- | --- | --- | --- |
| Asset technical metadata | OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`, `schemas/artifacts/asset_manifest.schema.json` | Asset identity, media kind/format/resolution/duration should be explicit and validated | `StoragePort.inspectObject` returns only object MIME, size and SHA-256; Control API combines it with authorized Asset metadata | Storage unit tests and C04 API confirmation tests |

Not migrated: OpenMontage `path`, project directories, Backlot, provider/source-tool fields, filesystem state and Python runtime code. Storage never imports persistence, Control API pages, Provider adapters or Veyra.
