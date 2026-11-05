# vukko-db

SQLite schema, numbered migrations, legacy Room adoption and integrity checks.

## Contract with the Kotlin application

The shipped Kotlin app writes `vukko_sovereign.db` (Room, `user_version = 1`).
This crate opens that same file in place:

| Room version | Rust action |
|---|---|
| file absent | create the schema from `0001` and run every migration |
| `1` (legacy Room) | back up, run `0001` (no-op) … `0004`, validate, keep the backup for one launch |
| `2`–`3` | run the remaining migrations |
| `4` | nothing |
| `> 4` | refuse (`DbError::Unsupported`), file untouched |

On any failure the file is restored from `<db>.premigration-backup` and the
error reports which step failed, so a failed upgrade is retryable instead of
fatal.

## Migrations

`migrations/*.sql` are embedded with `include_str!`, so a binary can never
disagree with the schema it was built against.

- `0001_legacy_room_schema.sql` — the exact Room v1 DDL (also the fresh-install
  baseline; every statement is `IF NOT EXISTS`).
- `0002_add_indexes.sql` — repairs normalised enum values, the cached counters
  and the transient `isStreaming` flag; adds the composite message index and
  sender-domain triggers.
- `0003_add_backup_metadata.sql` — `backup_runs` history.
- `0004_add_provider_secrets_metadata.sql` — `provider_secrets`: a keystore
  *reference* per provider, never the secret itself.

Migrations are forward-only. A released migration is never edited; a mistake is
corrected by appending a new one.

## Verification

`cargo test -p vukko-db` covers fresh install, repeated adoption, legacy upgrade,
enum repair, newer-version refusal, orphan detection with restoration, corrupt
files, and the column contract. The same scenarios run in this repository's
JavaScript suite against a real SQLite engine through
`tests/migration/support/adopt.cjs`; see `docs/RUST_VERIFICATION.md`.
