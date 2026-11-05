# Migration invariants

Phase 0.3 of [MIGRATION_PLAN.md](../MIGRATION_PLAN.md). Each invariant is paired
with the check that enforces it. A check named here must fail before the code
that violates it is merged.

| # | Invariant | Enforced by |
|---|---|---|
| 1 | Existing users retain local data | `tests/migration/fixtures/baseline.test.js` (legacy contents), `tests/baseline/invariants.test.js` → database filename; full guarantee lands with the Rust migration tests (Phase 3) |
| 2 | Application ID remains `com.aistudio.vukko.kzmp` | `tests/baseline/invariants.test.js` → *applicationId stays com.aistudio.vukko.kzmp* |
| 3 | Signing key remains unchanged | `tests/baseline/invariants.test.js` → debug signing config is preserved; release keystore is not in the repository, so this is a release-process check (see note) |
| 4 | Database filename remains `vukko_sovereign.db`, or an explicit migration path exists | `tests/baseline/invariants.test.js` → *database filename stays vukko_sovereign.db*; `tests/migration` (Phase 3 tests) |
| 5 | API keys and OAuth tokens are never logged | `tests/baseline/invariants.test.js` → *no Kotlin source logs credentials*; Rust side: `rust/crates/vukko-bridge` redaction tests |
| 6 | Secrets are not stored in plaintext | `tests/baseline/invariants.test.js` → *API keys and OAuth tokens are not stored in SharedPreferences*; `SecurePreferencesManager` (Keystore AES-GCM) |
| 7 | Local-first behaviour remains available offline | `tests/baseline/invariants.test.js` → *local search … stays local*; Rust repository tests run without network |
| 8 | Streaming chat cancellation remains supported | `tests/baseline/invariants.test.js` → *the chat executor keeps a cancellable streaming path*; bridge event tests (Phase 4) |
| 9 | Markdown, JSON and plain-text exports remain compatible | `tests/baseline/invariants.test.js` → *markdown, json and plain-text exports keep their documented headers*; Rust export tests (Phase 3) |
| 10 | Provider/model identifiers remain stable | `tests/baseline/invariants.test.js` → *provider identifiers are unchanged*, *model identifiers are unchanged* |
| 11 | Workspace/thread/message/document/citation/agent-step IDs remain stable | `tests/baseline/invariants.test.js` → *bootstrap seed identifiers stay stable*; `tests/migration` round-trip assertions |
| 12 | No destructive schema migration | `tests/baseline/invariants.test.js` → *the Room database no longer falls back to destroying user data* |
| 13 | Schema changes are testable against real DDL | `tests/baseline/invariants.test.js` → *Room schema export is enabled*; `app/schemas/` output |
| 14 | Column nullability, boolean and timestamp representation are preserved | `tests/migration/fixtures/baseline.test.js` → nullable, boolean and millisecond assertions |

## Notes

- Invariant 3 (signing key): no release keystore is committed to this
  repository, so the check asserts what is checkable — the debug signing
  configuration and application id are untouched. Release signing must stay in
  the existing protected CI environment; the `android` Gradle module is
  preserved rather than regenerated, so the release `signingConfig` block stays
  byte-identical.
- Invariants 1, 5 (Rust side), 7 (Rust side), 8, 9 and 11 become executable
  Rust tests in Phase 3/4; until then their Kotlin/static checks above are the
  enforcing gate, and the ledger records the deferral.
