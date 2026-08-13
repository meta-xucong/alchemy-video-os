# C02 source record

- Source repository: `calesthio/OpenMontage`
- Fixed commit: `4eab34c5cfcccaa4f1970554928feccce73ee930`
- Source file: `tests/contracts/test_phase0_contracts.py`
- Reused approach: exported schemas are protected by automated contract tests.
- Platform implementation: `src/specifications.ts` and `tests/contract-export.test.ts` make Zod the sole DTO/event source and verify the generated OpenAPI, AsyncAPI and JSON Schema files.
- Not migrated: OpenMontage Artifact schemas, Python runtime, Backlot, filesystem events and tool inputs.
- Regression command: `pnpm --filter @alchemy-video/contracts test`

## C04 Asset and Shot contracts

- Source repository: `calesthio/OpenMontage`
- Fixed commit: `4eab34c5cfcccaa4f1970554928feccce73ee930`
- Source files: `schemas/artifacts/asset_manifest.schema.json`, `tests/contracts/test_phase0_contracts.py`
- Reused approach: Asset media type and technical metadata are explicit contract fields, and exported schemas have a regression gate.
- Platform implementation: `src/resources.ts` defines public upload/confirm/download and Shot/ReferenceBinding DTOs; `src/specifications.ts` exports only the safe public fields. Object keys, signed URL query parameters, provider identifiers and raw payloads remain outside public generated contracts.
- Not migrated: Artifact file paths, source tool/provider fields, Backlot/project state, Python runtime types, local filesystem outputs and media binaries.
- Regression commands: `pnpm contracts:generate`, `pnpm --filter @alchemy-video/contracts test`, `pnpm --filter @alchemy-video/control-api test:e2e`.
