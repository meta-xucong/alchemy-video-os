# Upstream Migration Record

## C04 Storage Boundary

No upstream repository supplies a reusable, workspace-scoped S3 storage adapter. This package is a platform-owned S3-compatible port built on the AWS SDK so that MinIO and a future S3 deployment share the same isolated boundary.

| Target | Source | Retained convention | Platform adaptation | Regression coverage |
| --- | --- | --- | --- | --- |
| Asset technical metadata | OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`, `schemas/artifacts/asset_manifest.schema.json` | Asset identity, media kind/format/resolution/duration should be explicit and validated | `StoragePort.inspectObject` returns only object MIME, size and SHA-256; Control API combines it with authorized Asset metadata | Storage unit tests and C04 API confirmation tests |

Not migrated: OpenMontage `path`, project directories, Backlot, provider/source-tool fields, filesystem state and Python runtime code. Storage never imports persistence, Control API pages, Provider adapters or Veyra.

## 2026-09-06 provider-input relay HEAD boundary (platform thin shell)

The real-provider reference relay performs an HTTP `HEAD` preflight before the
upstream downloads an image. `S3StoragePort.inspectObject` remains the
integrity path for upload confirmation and computes SHA-256 by reading the
object body; it is not used for the relay `HEAD`. The platform-owned
`inspectObjectMetadata` method maps only the existing S3 `HeadObject` MIME and
content length, while the Control API still verifies the signed asset claim,
workspace/project, READY status, allowed image MIME and stored SHA/size before
calling it. A storage implementation without this internal capability fails
closed instead of falling back to a full object download. GET and upload
confirmation semantics are unchanged.

Evidence: storage-client `7 passed / 1 explicit MinIO-gated skip`, Control API
C06 relay tests `12/12`, storage/control typecheck and build passed. This is a
platform storage/HTTP boundary; no OpenMontage media algorithm, Provider
protocol, public contract or state transition was added.
