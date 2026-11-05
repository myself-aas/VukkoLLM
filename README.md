# Vukko

Local-first AI workspace. The shipped Android app is Kotlin + Jetpack Compose;
this branch also carries the in-progress migration to React Native (New
Architecture) + Rust, executed from [MIGRATION_PLAN.md](MIGRATION_PLAN.md).

## Migration status

| Phase | State | Where |
|---|---|---|
| 0 Baseline and invariants | done | `docs/INVARIANTS.md`, `docs/FEATURE_MATRIX.md`, `tests/baseline`, `tests/invariants` |
| 1 React Native shell | partial — TypeScript app, Jest harness and theme exist; the `android/` and `ios/` hosts are not generated yet | `src/`, `__tests__/`, `package.json` |
| 2 Shared domain contracts | done | `src/types/`, `rust/crates/vukko-core/src/domain/`, `tests/contracts` |
| 3 Room → Rust SQLite | done | `rust/crates/vukko-db/`, `tests/migration` |
| 4 Repository and ViewModel port | done | `rust/crates/vukko-core/src/{repository,services}`, `rust/crates/vukko-bridge/`, `tests/repository` |
| 5 Providers, streaming, cancellation | done | `src/services/providers/`, `src/services/chatService.ts`, `rust/crates/vukko-core/src/providers/`, `rust/crates/vukko-core/src/services/chat.rs` |
| 6 UI port | done for the chat surface; workspace/instance dialogs are not ported | `src/theme/`, `src/components/`, `src/screens/ChatScreen/`, `tests/ui` |
| 7 Native integrations | done as adapters | `src/native/integrations.ts`, `rust/crates/vukko-core/src/services/{files,backup}.rs`, `tests/native` |
| 8 Rust build and packaging | documented and pinned | `rust/README.md`, `rust/rust-toolchain.toml` |
| 9 Testing strategy | done | `tests/`, `tests/e2e/lifecycle.test.js` |
| 10 CI/CD | done | `.github/workflows/`, `tests/ci` |
| 11 Incremental rollout | criteria executable | `docs/ROLLOUT.md`, `tests/rollout` |

### Verification, honestly

This migration was authored in an environment with **no Rust toolchain, no JDK
and no Android SDK**. `npm test`, `npx tsc --noEmit`, ESLint and Prettier are
green here; Rust is syntax-checked with tree-sitter and compiled for
the first time in CI, where no step is allowed to fail quietly.
[docs/RUST_VERIFICATION.md](docs/RUST_VERIFICATION.md) is the full account, and
`.superpowers/sdd/MIGRATION_PLAN/progress.md` records every decision with its
cost-if-wrong.

## Working on it

```bash
npm ci
npm test              # jest: contracts, repositories, providers, UI, e2e, CI gates
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run format:check  # prettier
```

---

# The application it replaces



AnythingLLM is the all-in-one AI client and workspace assistant application, rewritten in native Kotlin with Jetpack Compose and Material 3.

## Features

- **Workspaces & Knowledge Base**:
  - Create and manage isolated workspaces with custom system prompts, temperatures, and query modes (Chat vs Query / RAG).
  - Manage uploaded documents (PDFs, Markdown, text files, and web links) with simulated vector chunk indexing and source attribution.
- **Multiple LLM Providers**:
  - Connect to **Google Gemini** (Gemini 2.5 Flash, 2.5 Pro, 1.5 Flash), **OpenAI** (GPT-4o, GPT-4o-mini, o3-mini), **Anthropic** (Claude 3.5 Sonnet, 3.5 Haiku), **DeepSeek** (DeepSeek-V3, DeepSeek-R1), **Groq** (Llama 3.3 70B, Mixtral 8x7B), and **Ollama** (Local/LAN).
  - Top-bar Model Chip with instant provider and model switcher.
  - Persistent per-provider API key management.
- **AnythingLLM Server / Desktop Sync**:
  - Connect directly to self-hosted AnythingLLM Desktop or Server instances via REST API.
- **Rich Chat Interface**:
  - Collapsible Chain-of-Thought (Reasoning) accordion with timer for reasoning models (DeepSeek-R1, o3-mini, Gemini 2.5).
  - Clean Markdown formatting and syntax-highlighted code blocks with 1-tap "Copy Code".
  - Source citations chips displaying matched knowledge base documents, sections, and relevance scores.
  - Context attachment bar supporting notes, documents, and web links.
- **Agent Tools**:
  - Web search tool for retrieving external context.
  - Calculator and unit evaluation tool.
  - Document summarizer.
- **Quick Actions (Text Processing)**:
  - Summarize, Fix & Polish, Explain Simply, Make Formal, and Translate text snippets.
- **Persistent Local Storage & Data Sovereignty (Room SQLite)**:
  - 100% On-device data sovereignty: all workspaces, chat threads, session histories, system instructions, citations, agent execution logs, and knowledge base documents are saved locally in Android Room SQLite (`anythingllm_sovereign.db`).
  - Zero external server transmission or telemetry: your personal conversations and documents stay strictly in your device's sandboxed storage.
  - Reactive `Flow` architecture: dynamic updates across multi-step agent executions and session switches.
  - Data Sovereignty Inspector dialog with live database metrics, integrity check (`PRAGMA integrity_check`), and one-tap audit export.
- **Export**:
  - Export chat threads to Markdown, JSON, or formatted Plain Text.

## Tech Stack

- **Platform**: Android SDK 36 (minSdk 26)
- **Language**: Kotlin 2.1
- **UI Framework**: Jetpack Compose with Material Design 3 (M3)
- **Local Persistence**: Android Room Database 2.6.1 + KSP (`anythingllm_sovereign.db`)
- **Architecture**: MVVM with Repository Pattern, Kotlin Coroutines, & reactive StateFlow
- **Typography**: Plus Jakarta Sans (bundled locally in `res/font/`)
- **Theme**: Signature AnythingLLM Dark Theme (`#131314` obsidian background with Cyan `#06B6D4` accents)

## Repository status

This repository is mid-migration from Kotlin/Jetpack Compose to React Native +
Rust. Practical entry points:

- [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md) — the staged plan.
- [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) — every Kotlin surface and its replacement.
- [`docs/INVARIANTS.md`](docs/INVARIANTS.md) — behaviour that must not regress, and the test that enforces it.
- [`docs/RUST_VERIFICATION.md`](docs/RUST_VERIFICATION.md) — what is verified locally vs. in CI.

```bash
npm install          # JS/TS toolchain (React Native 0.81, Jest, TypeScript)
npm test             # all Jest suites (baseline, migration, provider, UI)
npm run typecheck    # tsc --noEmit
```
