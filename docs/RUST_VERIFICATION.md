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
| Rust domain/repository/provider/bridge code | **nothing local**; enforced by the same behaviour also being implemented and tested in TypeScript (`src/bridge/localBridge`) so the JS side of every contract is executable here | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` |
| Android host (package id, signing, launch) | static invariants only (`tests/baseline/invariants.test.js`) | `./gradlew assembleDebug`, instrumentation tests |
| iOS host | nothing | Xcode build on a macOS runner |

## Consequences that are enforced, not just noted

1. Every Rust module has a TypeScript twin that implements the same documented
   contract and is tested here. The Rust implementation must satisfy the same
   tests in CI; a divergence fails CI, not the local run.
2. No Rust file is committed that has never been compiled — the CI `rust.yml`
   workflow is required for the PR that adds it. Until a Rust toolchain is
   available, `cargo` steps are marked `continue-on-error: false` so the first
   real CI run is the compile gate.
3. Anything the local environment cannot prove is called out in the ledger with
   `Ruling:` so the reviewer sees it rather than discovering it at merge time.
