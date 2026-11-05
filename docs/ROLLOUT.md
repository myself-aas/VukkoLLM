# Incremental rollout

Phase 11 of [MIGRATION_PLAN.md](../MIGRATION_PLAN.md). The order is fixed: each
stage is only reachable when the previous one's acceptance criteria are green in
CI *and* have been observed on a device.

| Milestone | Deliverable | Acceptance criteria | Proven by |
|---|---|---|---|
| A | React Native shell, Android host, theme, CI | the app launches with the shipped application id; signing paths unchanged; startup does not require Rust | `tests/rollout/milestones.test.js` → *Milestone A*, `tests/baseline/invariants.test.js` |
| B | Rust persistence, bridge, legacy migration | existing Kotlin databases migrate; fixture records are preserved; RN can browse and edit persisted data | `tests/migration/adoption.test.js`, `tests/repository/repositories.test.js` |
| C | Providers, streaming, cancellation | mock provider deterministic; at least one real provider end to end; offline and invalid-credential states explicit | `tests/providers/*`, `tests/e2e/lifecycle.test.js` |
| D | Documents, citations, agent steps, export, storage, GitHub, backup, biometrics, voice | feature matrix shows parity; no production path depends on fake data | `docs/FEATURE_MATRIX.md`, `tests/rollout/milestones.test.js` → *Milestone D*, `tests/services/githubService.test.ts` |
| E | Remove Compose, Room, Kotlin repositories/ViewModels/providers | only native adapter code remains; the ported tree does not reference Kotlin | `tests/rollout/milestones.test.js` → *Milestone E* |
| F | Staged distribution | internal debug → internal release → closed beta → small percentage → full | `.github/workflows/release.yml`, this document |

## Staged distribution

1. **Internal debug builds** — every PR, from CI artefacts.
2. **Internal release builds** — the `release` workflow, signed in the protected
   `production` environment.
3. **Closed beta** — a fixed cohort; the migration path is exercised by real
   legacy databases rather than fixtures.
4. **Small production percentage** — 5 %, then 25 %, then 100 %, with the
   abort criteria below.
5. **Full rollout.**

## What is monitored, and where the signal comes from

| Failure mode | Signal | Abort criterion |
|---|---|---|
| Migration failure | `Migration` result in `InitializationState`; `warnings[]`; the retained `*.premigration-backup` file | any `FAILED` adoption, or any legacy row count mismatch |
| Startup crash | `initialize()` throwing before the first frame | crash-free sessions below the previous release |
| Rust bridge failure | rejected bridge promises carrying `VukkoError` with code `STORAGE`/`NOT_INITIALIZED` | sustained rate above baseline |
| Database corruption | `runIntegrityCheck()` returning `ok: false`, or a non-empty `foreignKeyViolations` | any occurrence: stop the rollout |
| Provider errors | `message.failed` events by `error.code` (`AUTHENTICATION`, `NETWORK`, `VALIDATION`) | a rise in `AUTHENTICATION` after a release means a key path regressed |
| Backup failures | `BackupResult.status` of `FAILED`/`UNSUPPORTED`, with the local archive retained | a `COMPLETED` result with no uploaded file is treated as a P0 |
| ANRs, memory pressure, native crashes | platform vitals | outside historical bounds |

## Abort and roll back

The application id, signing key and database filename are unchanged by the
migration, so the rollback path is the previous APK: it opens the same database
file, which the Rust layer only ever extends forward (migrations are additive,
and the legacy Room tables keep their names and columns). Rolling back after a
*newer* schema version has been written requires the retained pre-migration
backup; that is why the backup is never deleted automatically.
