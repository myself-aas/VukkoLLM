# Kotlin → React Native/Rust feature matrix

Phase 0.2 of [MIGRATION_PLAN.md](../MIGRATION_PLAN.md). One row per surface that
exists in the shipped Kotlin application today, where it lives, and what replaces
it. Status values:

- `port` — behaviour must be reproduced by the replacement.
- `adapter` — stays native, reduced to an OS-integration adapter.
- `drop` — behaviour is deliberately not carried over (with the reason).

| # | Current surface | Current location | Replacement | Status |
|---|---|---|---|---|
| 1 | Application startup, theme host, biometric gate | `app/src/main/java/com/vukko/MainActivity.kt` | React Native host (`android/app/.../MainActivity.kt`) + `src/app/App.tsx` | adapter |
| 2 | Main state orchestration, 553 lines, 40+ actions | `app/src/main/java/com/vukko/viewmodel/MainViewModel.kt` | Zustand stores in `src/store/*` backed by the Rust bridge | port |
| 3 | Data access, 869 lines, seeding, chat simulation, exports, stats | `app/src/main/java/com/vukko/data/DataRepository.kt` | Split Rust services (`rust/crates/vukko-core/src/repository/*`, `services/*`) | port |
| 4 | Room database, `vukko_sovereign.db`, version 1, destructive fallback | `app/src/main/java/com/vukko/data/local/AppDatabase.kt` | Rust SQLite + numbered migrations (`rust/crates/vukko-db`) | port |
| 5 | Room entities (workspaces, chat_threads, chat_messages, workspace_documents) | `app/src/main/java/com/vukko/data/local/entities/*.kt` | Rust schema with identical table/column names and Room DDL compatibility | port |
| 6 | Room DAOs (ordering, pinning, search, counters) | `app/src/main/java/com/vukko/data/local/dao/*.kt` | Repository query methods with the same ordering guarantees | port |
| 7 | JSON column codecs (citations, tools, attachments, agent steps, tags) | `app/src/main/java/com/vukko/data/local/RoomConverters.kt` | Rust serde codecs that read existing JSON unchanged | port |
| 8 | Settings in plaintext `SharedPreferences` (incl. API keys, GitHub tokens, SSH key) | `app/src/main/java/com/vukko/data/PreferencesManager.kt` | Rust settings API + native secure storage adapter (`SecurePreferencesManager` is the interim Keystore-backed store) | port + adapter |
| 9 | Provider + model registry (7 providers, 15 models) | `app/src/main/java/com/vukko/model/LLMProvider.kt` | Shared provider registry: Rust metadata as source of truth, typed TS mirror | port |
| 10 | Chat message, citation, tool-call, attachment, agent-step models | `app/src/main/java/com/vukko/model/ChatMessage.kt` | `rust/crates/vukko-core/src/domain/chat.rs` + `src/types/chat.ts` | port |
| 11 | Workspace, thread, query-mode model | `app/src/main/java/com/vukko/model/Workspace.kt` | `rust/crates/vukko-core/src/domain/workspace.rs` + `src/types/workspace.ts` | port |
| 12 | Documents, document types, quick actions registry | `app/src/main/java/com/vukko/model/DocumentItem.kt` | Domain modules + `src/types/document.ts` + quick-action constants | port |
| 13 | GitHub REST client (verify token, repos, commits, PRs, repo creation, SSH key check) | `app/src/main/java/com/vukko/data/github/GitHubService.kt` | Rust `github` client behind `RealGitHubService`, no seed/fallback data | port |
| 14 | GitHub OAuth device flow + simulated profile fallback | `app/src/main/java/com/vukko/data/github/GitHubOAuthManager.kt` | Rust device-flow client; simulated profile removed from production paths | port (fallback dropped) |
| 15 | Backup scheduling (WorkManager periodic work) | `app/src/main/java/com/vukko/data/sync/BackupManager.kt` | Native scheduler adapter (`WorkManager`/`BGTaskScheduler`) calling Rust backup logic | adapter |
| 16 | Backup worker (simulated cloud upload, file copy) | `app/src/main/java/com/vukko/data/sync/BackupWorker.kt` | Rust backup serialization + integrity verification; native upload adapter | port |
| 17 | Biometric prompt | `app/src/main/java/com/vukko/ui/components/BiometricAuthHelper.kt` | `BiometricsModule` TurboModule | adapter |
| 18 | Voice input (SpeechRecognizer) | `app/src/main/java/com/vukko/ui/components/VoiceToTextHandler.kt` | Native recorder/transcription module feeding React prompt state | adapter |
| 19 | Home-screen widget (Glance) | `app/src/main/java/com/vukko/widget/VukkoWidget.kt` | Native widget reading the shared JSON state snapshot | adapter |
| 20 | Chat screen composition | `app/src/main/java/com/vukko/ui/screens/ChatScreen.kt` | `src/screens/ChatScreen/` | port |
| 21 | Top bar, message list, prompt bar, typing indicator | `app/src/main/java/com/vukko/ui/components/{TopBar,MessageItem,PromptInputBar,TypingIndicator}.kt` | `src/components/{TopBar,MessageItem,PromptInputBar,TypingIndicator}/` | port |
| 22 | Markdown + code rendering | `app/src/main/java/com/vukko/ui/components/MarkdownText.kt` | `react-native-markdown-display` wrapper in `src/components/MarkdownText/` | port |
| 23 | Workspace drawer, workspace dialogs, workspace settings | `app/src/main/java/com/vukko/ui/components/{WorkspaceDrawer,WorkspaceDialogs,WorkspaceSettingsSheet}.kt` | `src/components/{WorkspaceDrawer,WorkspaceDialogs,WorkspaceSettings}/` | port |
| 24 | Model picker, instance connect sheet | `app/src/main/java/com/vukko/ui/components/{ModelPickerSheet,InstanceConnectSheet}.kt` | `src/components/{ModelPicker,InstanceConnect}/` | port |
| 25 | Settings sheet | `app/src/main/java/com/vukko/ui/components/SettingsSheet.kt` | `src/screens/SettingsScreen/` + `src/components/Settings/` | port |
| 26 | Sovereign storage inspector | `app/src/main/java/com/vukko/ui/components/SovereignStorageDialog.kt` | `src/components/StorageInspector/` fed by `getStorageStats()` | port |
| 27 | GitHub manager sheet | `app/src/main/java/com/vukko/ui/components/GitHubManagerSheet.kt` | `src/screens/GitHubScreen/` + `src/components/GitHubManager/` | port |
| 28 | Export dialog (Markdown/JSON/text) | `app/src/main/java/com/vukko/ui/components/ExportDialog.kt` | `src/components/ExportDialog/` + Rust `exportThread` | port |
| 29 | Quick actions, tag selection | `app/src/main/java/com/vukko/ui/components/{QuickActionsDialog,TagSelectionDialog}.kt` | `src/components/{QuickActions,TagSelection}/` | port |
| 30 | Design tokens (dark background, cyan accent, bundled fonts) | `app/src/main/java/com/vukko/theme/{Color,Theme,Type}.kt`, `app/src/main/res/font/` | `src/theme/*` + same font files | port |
| 31 | Simulated chat completion and scripted agent loop | `DataRepository.executeSendMessage`, `executeAgentMultiStepTask` | Real provider streaming in Rust; simulated path kept only as a deterministic mock provider for tests/E2E | port (fake content dropped from production) |
| 32 | Partial RN tree, not wired to any app | `src/screens/Onboarding/DataHandling/index.tsx`, `src/screens/WorkspaceChat/ChatHistory/Messages/Assistant/FileDownloadCard/index.tsx`, `src/utils/DocumentParser/registry.ts`, `src/utils/openaiResponses/index.ts` | Rewritten against real modules; treated as reference material only | port (rewrite) |
| 33 | In-app unit tests referenced by the plan (`GitHubOperationsTest`, `RoomDataSovereigntyTest`) | absent from the repository | Replaced by `tests/**` (baseline, migration, provider, bridge) | drop (never existed) |
| 34 | Destructive Room fallback on version bump | `AppDatabase.getInstance` | Removed; versioned migrations only | drop |

## Notes on rows that changed in this task

- Row 4 and row 34: `fallbackToDestructiveMigration()` was removed in this task
  and `exportSchema = true` was enabled so real Room DDL can be used as the
  migration fixture (`tests/migration/fixtures/legacy_room_v1.sql`).
- Row 8: credential accessors moved to `SecurePreferencesManager` (Keystore
  AES-GCM) in this task; `PreferencesManager` still exposes the same Kotlin
  property names so call sites are unchanged.
- Row 33: the two JVM tests named in the plan do not exist in the repository;
  `tests/baseline` and `tests/migration` replace them with executable checks.
