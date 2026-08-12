# C02 source record

No upstream domain implementation is migrated into this package.

Huobao's task state is coupled to short-drama entities, MySQL rows and in-process Provider polling. OpenMontage's task state is coupled to local files and `events.jsonl`. Both conflict with this platform's persistent `TaskRun` aggregate and are deliberately excluded.

- Source records reviewed: huobao-drama `backend/src/db/schema.ts`, OpenMontage `tests/contracts/test_phase0_contracts.py`
- Platform source of truth: `doc/AI企业内容生产平台_领域模型与API事件契约.md`
- Regression command: `pnpm --filter @alchemy-video/domain test`
