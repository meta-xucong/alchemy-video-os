# C02 source record

- Source repository: `calesthio/OpenMontage`
- Fixed commit: `4eab34c5cfcccaa4f1970554928feccce73ee930`
- Source file: `tests/contracts/test_phase0_contracts.py`
- Reused approach: exported schemas are protected by automated contract tests.
- Platform implementation: `src/specifications.ts` and `tests/contract-export.test.ts` make Zod the sole DTO/event source and verify the generated OpenAPI, AsyncAPI and JSON Schema files.
- Not migrated: OpenMontage Artifact schemas, Python runtime, Backlot, filesystem events and tool inputs.
- Regression command: `pnpm --filter @alchemy-video/contracts test`
