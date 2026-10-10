# Upstream Migration Record

## C04 Storage Boundary

No upstream repository supplies a reusable, workspace-scoped S3 storage adapter. This package is a platform-owned S3-compatible port built on the AWS SDK so that MinIO and a future S3 deployment share the same isolated boundary.

## 2026-10-10 upload reservation and inspection bounds

Platform boundary adaptation against the installed AWS SDK `3.750.0`:
`PutObjectCommand.ContentLength` binds the persisted upload reservation, and
`getSignedUrl` explicitly signs content-length/content-type/if-none-match.
The browser supplies Content-Length from its File/Blob; it is not returned as a
JavaScript-set header. The signing-only S3 client uses the SDK-supported
`requestChecksumCalculation: WHEN_REQUIRED`, avoiding the default CRC32 of an
absent signing body. Ordinary server writes retain SDK checksum defaults and
upload confirmation still calculates the actual SHA-256. No fake checksum or
new public request field is introduced.

Sources: [AWS checksum configuration](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html),
[AWS JavaScript checksum behavior](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html),
and installed `@aws-sdk/s3-request-presigner` `getSignedUrl`/`S3RequestPresigner`.
Inspection checks reserved size/MIME on HEAD before GET, uses the HEAD ETag for
conditional GET, counts actual stream bytes, and aborts after 30 seconds or caller
cancellation. The public confirmation route inspects once before the repository
transaction and passes only verified facts into its callback, preserving replay
and transient-error behavior. These are storage/resource bounds, not new media
parser or reference-source semantics.

Rejected objects are not automatically deleted. Conditional-delete enforcement
is not certified for the pinned S3-compatible backend, and a raced deletion must
not remove an accepted asset or a pending internal import. Oversize legacy objects
therefore require operator cleanup through existing retention procedures; the
new length-bound PUT prevents new oversize uploads through newly issued URLs.
Regression evidence: storage unit tests (real SDK signing, HEAD rejection,
overflow, stalled reads, length consistency and memory parity),
`upload-bounds.test.ts`, `reference-read-bounds.test.ts`, and the opt-in MinIO
upload integration test.

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
