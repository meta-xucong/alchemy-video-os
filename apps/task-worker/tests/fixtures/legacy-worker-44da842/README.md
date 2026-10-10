# Pinned pre-reservation Worker

These files are byte-for-byte copies from platform commit
`44da8428d2c1b73648eb1616cd0350dac798eba8`. `manifest.json` records each original
repository path and SHA-256. The always-on integrity test rejects fixture edits.
Regenerate from that commit with `git show <commit>:<source>`; do not update the
old implementation to make a regression pass.

The fixture contains the original executor, event consumer/recovery service,
task repository, Drizzle schema, and their local runtime dependencies. Original
paths and relative imports are retained. Type-only dependencies are erased by
the existing tsx loader. Workspace runtime imports use the installed, locked
packages; the contract/domain symbols and Mock Provider implementation used by
these tests are unchanged from the pinned commit. This is a targeted old Worker
execution chain, not a complete historical deployment image.

The test uses the pinned Mock Provider behind a loopback-only HTTP server. Its
request/response barrier delays mock acceptance until the actual committed 0028
migration completes. Repository observation forwards calls unchanged and records
their original PostgreSQL errors before the old executor normalizes them.
No Worker algorithm, SQL statement, or state transition is reimplemented here.

The integration cases create and drop their own randomly named databases on a
loopback PostgreSQL 16 server from `LEGACY_FENCE_TEST_DATABASE_URL` (the role
needs `CREATEDB`). Both legacy fence suites validate the dedicated URL before
constructing a client: the authority and every `host`/`hostaddr` override must
be exactly `127.0.0.1`. There is no fallback to the generic `DATABASE_URL`.
They apply the repository's actual migrations through 0027 before applying 0028.
They never rename columns in the shared integration database. Without
`LEGACY_FENCE_TEST_DATABASE_URL`, only the non-database tests run and integration cases are
explicitly skipped. No Git history, GitHub access, Redis, media files, or real
Provider credentials are needed at test runtime.

The fixture directory has an explicit `text eol=lf` Git attribute. This preserves
the original bytes with Windows `core.autocrlf=true`; the integrity assertion
still hashes raw bytes without newline normalization. A separate Git checkout
regression verifies the attribute and rejects altered bytes.

Queue coverage invokes the original persisted event consumer and duplicate
delivery path. It does not claim to exercise the BullMQ transport or scheduling.
Recovery and finalization likewise call the original old Worker and repository.
