# Verification strategy (local vs. CI)

The sandbox this migration is being executed in has **no Rust toolchain
(`cargo`/`rustc`), no JDK, and no Android SDK**, and its network access is
limited to the npm registry, GitHub, and PyPI — `static.rust-lang.org`,
`crates.io`, `static.crates.io` and Debian mirrors are unreachable. That shapes
how each layer of the migration is verified. This file is the record of what is
actually proven where, so a green local run is never mistaken for a green
build.

| Layer | Verified locally | Verified in CI |
|---|---|---|
| JS/TS config, Jest harness, React components, stores, bridge typing | `npm test`, `npm run typecheck` — fully | same, plus lint/format |
| Legacy Room ASCII contract (DDL, defaults, indexes, ordering, JSON columns, failure modes) | `tests/migration/fixtures/baseline.test.js` against a real SQLite engine (`node:sqlite`) | same, plus golden fixtures exported from the Kotlin app |
| Room ↔ Rust migration behaviour | **nothing local** — the migration logic is Rust | `cargo test -p vukko-db` on fixture databases produced by `scripts/build-fixtures.cjs` |
| Rust domain/repository/provider/bridge code | **nothing local**; enforced by the same behaviour also being implemented and tested in JavaScript — `tests/support/engine.cjs` for the repositories, `tests/migration/support/adopt.cjs` for adoption, `src/services/providers` for wire parsing, `src/services/chatService.ts` for the streaming lifecycle — so the contract of every Rust module is executable here | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` |
| Android host (package id, signing, launch) | static invariants only (`tests/baseline/invariants.test.js`) | `./gradlew assembleDebug`, instrumentation tests |
| iOS host | nothing | Xcode build on a macOS runner |

## Consequences that are enforced, not just noted

1. Every Rust module has a TypeScript twin that implements the same documented
   contract and is tested here. The Rust implementation must satisfy the same
   tests in CI; a divergence fails CI, not the local run.
2. No Rust file is committed without a syntax check: `tests/tooling/rustSyntax`
   parses every `.rs` file with tree-sitter and fails on an ERROR or MISSING node,
   so a stray brace is caught here rather than only by cargo. It is a syntax
   gate, not a type check — the CI `rust.yml` workflow is the compile gate, and
   no `cargo` step is `continue-on-error`, so the first real CI run decides.
3. Anything the local environment cannot prove is called out in the ledger
   (`.superpowers/sdd/MIGRATION_PLAN/progress.md`) with `Ruling:` so the reviewer
   sees it rather than discovering it at merge time.
4. Phase 8 code generation (Step 8.3) is not exercised locally: the generated
   bridge artefacts are not committed, and CI's cargo build plus the syntax gate
   are the gate for them. Recorded in the ledger as a Task 8 ruling.
