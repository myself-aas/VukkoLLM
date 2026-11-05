# Kotlin/Compose to React Native + Rust Refactor Plan

## 1. Intake findings and migration constraints

The repository is currently a hybrid-in-progress:

- The buildable Android application is Kotlin/Jetpack Compose:
  - `app/src/main/java/com/vukko/MainActivity.kt`
  - `app/src/main/java/com/vukko/ui/**`
  - `app/src/main/java/com/vukko/viewmodel/MainViewModel.kt`
  - `app/src/main/java/com/vukko/data/**`
- The Android build is configured with Kotlin 2.1, Compose, Room, WorkManager, OkHttp, Coil, biometric APIs, and Glance widgets in `app/build.gradle.kts`.
- The primary application state and business logic are concentrated in:
  - `DataRepository.kt` — 869 lines
  - `MainViewModel.kt` — 553 lines
- A partial React Native/TypeScript tree already exists under `src/**`, but the repository currently lacks tracked `package.json`, `yarn.lock`, `android/`, `ios/`, Rust crates, Metro configuration, and React Native build configuration.
- `DEVELOPMENT.md` describes a React Native application, but its documented structure does not match the currently tracked repository.
- The current Android package/application identity is `com.aistudio.vukko.kzmp`; this must be preserved for in-place upgrades.
- The Room database is named `vukko_sovereign.db` and currently uses destructive migration fallback in `AppDatabase.kt`. This is a data-loss risk that must be resolved before replacing the native application layer.

This migration must therefore be treated as a staged platform replacement with data compatibility, not as a direct source-to-source rewrite.

## 2. Target architecture

### 2.1 Technology boundaries

React Native/TypeScript owns:

- Screens and navigation
- User interaction and presentation state
- Forms, dialogs, sheets, lists, and animations
- Accessibility and localization
- React-side orchestration
- Provider/model selection UI
- Workspace and thread UI
- Chat rendering
- Export UI
- Settings UI

Rust owns:

- Stable domain models and validation
- Local database access and migrations
- Repository operations
- Chat/thread/workspace persistence
- Provider request orchestration
- Streaming response normalization
- Document metadata and indexing primitives
- Citation and agent-step models
- Backup serialization and integrity verification
- Secure token/key abstractions where feasible
- Deterministic business rules
- Cross-platform tests

Thin native platform adapters own:

- React Native host startup
- Android/iOS lifecycle integration
- Secure storage implementation
- Biometrics
- File picker/share sheet
- Notifications and background scheduling
- Audio recording
- Widgets
- Native filesystem paths
- Rust library loading and bridge registration

Business logic should not remain in Kotlin or Swift. Native platform code should be limited to adapters and OS integration.

### 2.2 Recommended Rust bridge

Use a typed React Native New Architecture TurboModule boundary.

Recommended Rust layout:

```text
rust/
├── Cargo.toml
├── crates/
│   ├── vukko-core/
│   │   ├── src/domain/
│   │   ├── src/repository/
│   │   ├── src/providers/
│   │   ├── src/backup/
│   │   └── src/lib.rs
│   ├── vukko-db/
│   │   ├── migrations/
│   │   ├── src/schema.rs
│   │   └── src/lib.rs
│   └── vukko-bridge/
│       ├── src/lib.rs
│       └── src/error.rs
├── Cargo.lock
└── deny.toml
```

The bridge should expose domain-oriented asynchronous operations rather than database tables:

```ts
interface VukkoNativeModule {
  initialize(): Promise<InitializationState>;
  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  listThreads(workspaceId: string): Promise<WorkspaceThread[]>;
  listMessages(threadId: string): Promise<ChatMessage[]>;
  sendMessage(input: SendMessageInput): Promise<ChatRequestId>;
  cancelMessage(requestId: string): Promise<void>;
  subscribeToChatEvents(listener: ChatEventListener): () => void;
  exportThread(input: ExportThreadInput): Promise<ExportResult>;
  getStorageStats(): Promise<SovereignStorageStats>;
  runIntegrityCheck(): Promise<IntegrityCheckResult>;
}
```

## 3. Phase 0 — Establish a migration baseline

### Step 0.1: Freeze current behavior

Before changing architecture:

1. Build the current Android application.
2. Run the existing JVM tests:
   - `GitHubOperationsTest.kt`
   - `RoomDataSovereigntyTest.kt`
3. Create representative fixture data containing:
   - Multiple workspaces
   - Multiple threads
   - User and assistant messages
   - Citations
   - Attachments
   - Agent execution steps
   - Documents
   - Provider settings
   - Backup settings
4. Capture screenshots or recordings of:
   - Chat screen
   - Workspace drawer
   - Model picker
   - Settings
   - GitHub manager
   - Storage inspector
   - Export flows
5. Record the current database schema and sample rows.

These fixtures become the compatibility contract for the migration.

### Step 0.2: Inventory Kotlin behavior

Create a feature matrix mapping each Kotlin surface to its replacement:

| Current surface | Current location | Replacement |
|---|---|---|
| Application startup | `MainActivity.kt` | React Native host adapter |
| Main state orchestration | `MainViewModel.kt` | TypeScript stores/hooks backed by Rust |
| Data access | `DataRepository.kt` | Rust repository services |
| Room schema | `data/local/**` | Rust SQLite schema/migrations |
| Preferences | `PreferencesManager.kt` | Rust settings API plus secure storage adapter |
| Provider registry | `model/LLMProvider.kt` | Shared Rust provider metadata or TypeScript constants |
| Chat models | `model/ChatMessage.kt` | Shared Rust/TypeScript contract |
| Workspaces | `model/Workspace.kt` | Shared Rust/TypeScript contract |
| GitHub API | `data/github/**` | Rust HTTP service or typed TypeScript client |
| Background backup | `data/sync/**` | Rust backup logic plus native scheduler |
| Biometrics | `BiometricAuthHelper.kt` | Native biometric TurboModule |
| Voice input | `VoiceToTextHandler.kt` | Native audio adapter |
| Widget | `widget/VukkoWidget.kt` | Native Android widget adapter |
| Compose UI | `ui/**` | React Native screens/components |

### Step 0.3: Define invariants

Document and test these invariants:

- Existing users retain local data.
- The application ID remains `com.aistudio.vukko.kzmp`.
- The signing key remains unchanged.
- The database filename remains `vukko_sovereign.db`, or an explicit migration path exists.
- API keys and OAuth tokens are never logged.
- Local-first behavior remains available offline.
- Streaming chat cancellation remains supported.
- Markdown, JSON, and plain-text exports remain compatible.
- Existing provider/model identifiers remain stable.
- Workspace, thread, message, document, citation, and agent-step IDs remain stable during migration.

## 4. Phase 1 — Create the React Native shell

### Step 1.1: Add React Native project infrastructure

Add:

```text
package.json
yarn.lock
tsconfig.json
babel.config.js
metro.config.js
index.js
jest.config.js
.eslintrc.js
.prettierrc
react-native.config.js
```

Use React Native New Architecture from the beginning because Rust integration and future TurboModules depend on it.

Recommended initial dependencies:

- React Native and React
- React Navigation, React Native Screens, and Safe Area Context
- Gesture Handler and Reanimated
- TypeScript, Jest, and React Native Testing Library
- One global state system, such as MobX or Zustand
- NativeWind only if its conventions are adopted consistently
- Markdown rendering
- Secure storage
- File-system and document-picker libraries
- A typed HTTP client if network calls remain in TypeScript

Do not introduce both MobX and a second global state system.

### Step 1.2: Create Android and iOS hosts

Create:

```text
android/
ios/
```

Preserve:

- `applicationId "com.aistudio.vukko.kzmp"`
- Existing app label and launcher identity
- Minimum Android API 26 unless requirements change
- Target and compile SDK 36
- Release signing configuration
- Existing permissions
- Existing app versioning policy

Initially keep the Android host thin:

```text
android/app/src/main/java/com/aistudio/vukko/
├── MainActivity
├── VukkoApplication
├── NativeSecureStorageModule
├── NativeBiometricsModule
├── NativeFileModule
└── NativeBackgroundTaskModule
```

Do not port `DataRepository`, `MainViewModel`, or UI logic into this host.

### Step 1.3: Establish navigation and screen boundaries

Create:

```text
src/
├── app/
│   ├── App.tsx
│   ├── navigation/
│   └── providers/
├── screens/
│   ├── ChatScreen/
│   ├── WorkspaceScreen/
│   ├── SettingsScreen/
│   ├── OnboardingScreen/
│   └── GitHubScreen/
├── components/
├── hooks/
├── store/
├── services/
├── native/
├── types/
└── utils/
```

Verify existing React Native files before reuse. Files such as `src/screens/Onboarding/DataHandling/index.tsx`, `src/utils/DocumentParser/registry.ts`, and `src/utils/openaiResponses/index.ts` reference modules that are not currently present, so they should be treated as incomplete source material rather than production-ready components.

## 5. Phase 2 — Define shared domain contracts

### Step 2.1: Normalize the domain model

Port and formalize:

- `ChatMessage.kt`
- `DocumentItem.kt`
- `GitHubModels.kt`
- `LLMProvider.kt`
- `Workspace.kt`
- `SovereignStorageStats.kt`

Create TypeScript representations:

```text
src/types/
├── chat.ts
├── workspace.ts
├── document.ts
├── provider.ts
├── github.ts
├── backup.ts
├── storage.ts
└── native.ts
```

Create equivalent Rust types with explicit serialization. Serialize IDs as strings and use a single timestamp representation, such as ISO-8601 strings or integer Unix milliseconds.

Do not mix Kotlin `Long` semantics with JavaScript floating-point numbers without a defined serialization rule.

### Step 2.2: Define error contracts

Replace Kotlin `Result` and ad hoc exceptions with structured errors:

```ts
type VukkoError = {
  code:
    | "NOT_INITIALIZED"
    | "NOT_FOUND"
    | "VALIDATION"
    | "NETWORK"
    | "AUTHENTICATION"
    | "STORAGE"
    | "CANCELLED"
    | "UNSUPPORTED";
  message: string;
  retryable: boolean;
  details?: Record<string, string>;
};
```

Rust errors should serialize into this shape. Avoid returning mock success values for production failures.

## 6. Phase 3 — Migrate persistence from Room to Rust SQLite

### Step 3.1: Reconstruct the existing schema

The current Room entities are:

- `WorkspaceEntity.kt`
- `ChatThreadEntity.kt`
- `ChatMessageEntity.kt`
- `WorkspaceDocumentEntity.kt`
- `ThreadWithMessages.kt`

The Rust schema must preserve:

- Primary keys
- Foreign keys
- Default values
- Nullable fields
- Enum serialization
- Timestamp units
- JSON columns
- Existing table names
- Existing indexes
- Relationship ordering

Use `rusqlite` or `sqlx` with SQLite. Keep the public API domain-oriented and do not expose raw SQL through the JavaScript bridge.

### Step 3.2: Replace destructive migration behavior

Remove the equivalent of:

```kotlin
.fallbackToDestructiveMigration()
```

Implement numbered Rust migrations:

```text
rust/crates/vukko-db/migrations/
├── 0001_legacy_room_schema.sql
├── 0002_add_indexes.sql
├── 0003_add_backup_metadata.sql
└── 0004_add_provider_secrets_metadata.sql
```

Every migration must be transactional, versioned, tested against a fixture database, and forward-only.

### Step 3.3: Support existing installations

The upgrade path should:

1. Detect `vukko_sovereign.db`.
2. Copy it to a temporary backup before opening it.
3. Inspect the schema version and Room metadata.
4. Run a read-only compatibility migration.
5. Create or update the Rust-managed schema.
6. Copy or transform records transactionally.
7. Validate counts and foreign keys.
8. Mark migration complete.
9. Retain the backup until the next successful app launch.
10. Provide a recovery path if migration fails.

Do not delete the original database until validation succeeds.

Required migration tests:

- Empty database
- Database with only a workspace
- Database with nested threads and messages
- Messages containing citations and attachments
- Documents with nullable metadata
- Corrupted or partially written database
- Re-running the migration
- Upgrade from each supported historical schema version

### Step 3.4: Implement repository APIs

Create:

```text
rust/crates/vukko-core/src/repository/
├── workspace_repository.rs
├── thread_repository.rs
├── message_repository.rs
├── document_repository.rs
├── settings_repository.rs
├── export_repository.rs
└── storage_repository.rs
```

Each operation requires input validation, explicit transaction boundaries, typed return values, stable ordering, structured errors, and cancellation or bounded execution where applicable.

## 7. Phase 4 — Port repository and ViewModel behavior

### Step 4.1: Split `DataRepository.kt`

`DataRepository.kt` is the primary migration hotspot. Split its responsibilities before translating them:

```text
Rust:
├── WorkspaceService
├── ThreadService
├── MessageService
├── DocumentService
├── ProviderService
├── AgentService
├── ExportService
├── StorageService
└── BackupService
```

Do not recreate one 800-line Rust service.

### Step 4.2: Replace `MainViewModel.kt`

The current ViewModel exposes state for workspaces, threads, messages, documents, provider configuration, GitHub authentication, dialog visibility, export state, backup scheduling, and agent activity.

Replace it with focused React stores/hooks:

```text
src/store/
├── WorkspaceStore.ts
├── ChatStore.ts
├── ProviderStore.ts
├── GitHubStore.ts
├── SettingsStore.ts
├── BackupStore.ts
└── UIStore.ts
```

State should be normalized by IDs:

```ts
type ChatState = {
  messagesById: Record<string, ChatMessage>;
  messageIdsByThread: Record<string, string[]>;
  activeThreadId?: string;
  pendingRequests: Record<string, PendingRequest>;
};
```

Rust remains the source of truth for persisted state. React state represents loaded data, optimistic changes, and transient UI state.

### Step 4.3: Implement event subscriptions

Replace `StateFlow` with typed event subscriptions:

```ts
type NativeEvent =
  | { type: "workspace.updated"; workspace: Workspace }
  | { type: "thread.updated"; thread: WorkspaceThread }
  | { type: "message.created"; message: ChatMessage }
  | { type: "message.delta"; requestId: string; delta: string }
  | { type: "message.completed"; requestId: string; message: ChatMessage }
  | { type: "message.failed"; requestId: string; error: VukkoError }
  | { type: "backup.completed"; result: BackupResult };
```

The bridge must support subscription cleanup, multiple listeners, event ordering, request correlation, cancellation, and app restart recovery.

## 8. Phase 5 — Port provider and chat execution logic

### Step 5.1: Normalize providers

Port `ProviderType`, `ProviderConfig`, `LLMModel`, and `ProviderRegistry` into a shared registry.

Supported providers currently include:

- Gemini
- OpenAI
- Anthropic
- DeepSeek
- Groq
- Ollama
- Vukko/instance server

Create a Rust provider trait:

```rust
#[async_trait]
pub trait LlmProvider {
    async fn stream_chat(
        &self,
        request: ChatCompletionRequest,
        sink: EventSink,
    ) -> Result<ChatCompletionResult, ProviderError>;
}
```

Each provider implementation must normalize streaming chunks, tool calls, reasoning content, usage metadata, vision attachments, error responses, retryability, and context limits.

### Step 5.2: Separate local and remote inference

Use explicit execution modes:

```rust
pub enum InferenceBackend {
    Remote(RemoteProviderConfig),
    Ollama(OllamaConfig),
    Embedded(EmbeddedModelConfig),
}
```

If on-device Rust inference is required, integrate it behind the same trait. The React UI must not know provider-specific streaming formats.

### Step 5.3: Remove unsafe fallback behavior

The current GitHub and OAuth implementations contain simulated profiles, seed repositories, generated tokens, and fallback success results.

Replace these with:

- `MockGitHubService` for tests/demo builds
- `RealGitHubService` for production
- Explicit offline errors
- No generated credentials
- No fake successful authentication
- No swallowed exceptions
- No fallback data returned from production service methods

Apply the same separation to provider calls and document processing.

## 9. Phase 6 — Port the UI from Compose to React Native

### Step 6.1: Establish design tokens

Port:

- `theme/Color.kt`
- `theme/Theme.kt`
- `theme/Type.kt`
- Bundled fonts under `app/src/main/res/font/`
- Dark background and cyan accent palette
- Material 3 spacing and typography

Create:

```text
src/theme/
├── colors.ts
├── typography.ts
├── spacing.ts
├── radii.ts
├── shadows.ts
└── index.ts
```

Use one styling system. Do not mix NativeWind, inline styles, and ad hoc style objects without a documented rule.

### Step 6.2: Port screens in dependency order

1. App bootstrap and onboarding
2. Workspace drawer
3. Empty chat state
4. Chat message list
5. Prompt input and attachments
6. Streaming and typing state
7. Model picker
8. Workspace settings
9. Quick actions
10. Export dialogs
11. Storage inspector
12. General settings
13. GitHub manager
14. Voice input
15. Error and offline states

Map Compose components as follows:

| Compose component | React Native component |
|---|---|
| `ChatScreen.kt` | `src/screens/ChatScreen/` |
| `TopBar.kt` | `src/components/TopBar/` |
| `MessageItem.kt` | `src/components/MessageItem/` |
| `PromptInputBar.kt` | `src/components/PromptInputBar/` |
| `WorkspaceDrawer.kt` | `src/components/WorkspaceDrawer/` |
| `ModelPickerSheet.kt` | `src/components/ModelPicker/` |
| `SettingsSheet.kt` | `src/components/Settings/` |
| `WorkspaceSettingsSheet.kt` | `src/components/WorkspaceSettings/` |
| `SovereignStorageDialog.kt` | `src/components/StorageInspector/` |
| `GitHubManagerSheet.kt` | `src/components/GitHubManager/` |
| `ExportDialog.kt` | `src/components/ExportDialog/` |

### Step 6.3: Preserve behavior, not implementation details

Preserve workspace switching, thread creation/deletion, message streaming, reasoning accordions, Markdown/code rendering, citations, attachments, quick actions, document ingestion, GitHub operations, export formats, settings, biometric lock, storage metrics, and integrity checks.

Avoid reproducing Compose-specific state patterns in React. Keep React components presentational where possible.

## 10. Phase 7 — Implement native integrations

### Step 7.1: Biometrics

Replace `BiometricAuthHelper.kt` with a native module:

```ts
interface BiometricsModule {
  isAvailable(): Promise<boolean>;
  authenticate(options: AuthOptions): Promise<AuthResult>;
}
```

Store only the enabled/disabled preference. Never store biometric data.

### Step 7.2: Secure storage

API keys, OAuth tokens, and private keys must not be stored in plain SQLite.

Use:

- Android Keystore-backed encrypted storage
- iOS Keychain
- Rust opaque references or encrypted values
- Redacted diagnostics and logs

The React layer must never persist secrets in AsyncStorage.

### Step 7.3: Files and document imports

Implement a native file abstraction for PDF, Markdown, plain text, images, web links, export destinations, and share intents.

Rust should receive validated file descriptors or copied sandbox paths, not arbitrary platform URIs without permission handling.

### Step 7.4: Background backup

Keep scheduling native:

- Android: WorkManager adapter
- iOS: BGTaskScheduler adapter

Move backup serialization, integrity checking, and GitHub upload orchestration into Rust.

Expose only:

```ts
scheduleBackup();
cancelBackup();
runBackupNow();
```

Do not run long-lived Rust work directly from a React component.

### Step 7.5: Widget

`VukkoWidget.kt` cannot be directly replaced by React Native. Keep a small native widget implementation that reads a minimal shared state snapshot:

```json
{
  "activeWorkspaceName": "...",
  "activeThreadTitle": "...",
  "lastMessagePreview": "...",
  "updatedAt": 0
}
```

The main app updates this snapshot after relevant Rust events.

### Step 7.6: Voice input

Replace `VoiceToTextHandler.kt` with a native recorder/transcription adapter. Keep permissions, audio session handling, and lifecycle management native. Feed resulting text into the same React prompt state.

## 11. Phase 8 — Rust build and packaging

### Step 8.1: Android Rust builds

Add:

- `cargo-ndk`
- Android NDK configuration
- ABI targets `arm64-v8a`, `armeabi-v7a` if required, and `x86_64` for emulators
- Release and debug Rust profiles
- Native library packaging into `android/app/src/main/jniLibs`

Pin Rust, NDK, cargo-ndk, Gradle, Node, and React Native versions.

### Step 8.2: iOS Rust builds

Add targets:

- `aarch64-apple-ios`
- `aarch64-apple-ios-sim`
- `x86_64-apple-ios` only if required

Generate XCFrameworks, integrate them into Xcode build phases, and retain symbols for crash diagnostics.

### Step 8.3: Bridge code generation

Keep one source of truth for the bridge contract:

```text
src/native/specs/VukkoNativeModule.ts
```

Generate native registration code as part of the build. CI must fail when generated files are stale.

## 12. Phase 9 — Testing strategy

### 12.1 Rust unit and integration tests

Cover:

- Entity serialization
- Database migrations
- Foreign-key behavior
- Workspace/thread/message repositories
- Message ordering
- Provider normalization
- Streaming event handling
- Cancellation
- Export formatting
- Backup archives
- Integrity checks
- GitHub response parsing
- Invalid credentials
- Offline behavior

### 12.2 React Native tests

Use React Native Testing Library for:

- Onboarding
- Workspace creation
- Thread switching
- Prompt submission
- Streaming message rendering
- Retry/cancel states
- Provider selection
- Settings persistence
- Export actions
- Accessibility labels
- Empty and error states

### 12.3 Native integration tests

Test:

- App startup
- Rust library loading
- TurboModule registration
- Secure storage
- Biometrics
- File picker
- Share sheet
- Background backup
- Widget snapshot updates
- Deep links and external intents

### 12.4 Migration tests

Create golden database fixtures from the current Room schema and assert row counts, field equality, ordering, nullable values, JSON preservation, attachments, citations, and referential integrity.

Also test repeated migration, corrupted databases, and upgrades from every supported schema version.

### 12.5 End-to-end test

The minimum E2E scenario is:

1. Install a fresh app.
2. Complete onboarding.
3. Create a workspace and thread.
4. Send a message using a mock provider.
5. Receive streamed content.
6. Restart the app.
7. Confirm data persists.
8. Export the thread.
9. Run a storage integrity check.
10. Trigger backup.
11. Upgrade from a legacy Kotlin database.
12. Confirm all data remains available.

## 13. Phase 10 — CI/CD replacement

Add:

```text
.github/workflows/
├── lint.yml
├── typecheck.yml
├── rust.yml
├── android.yml
├── ios.yml
├── migration-tests.yml
├── e2e.yml
└── release.yml
```

Required CI jobs:

1. Install JavaScript dependencies with a frozen lockfile.
2. Run TypeScript type-checking.
3. Run ESLint and formatting checks.
4. Run `cargo fmt --check`.
5. Run `cargo clippy --all-targets --all-features -- -D warnings`.
6. Run Rust tests.
7. Run database migration fixture tests.
8. Build the Android debug application.
9. Run Android unit and instrumentation tests.
10. Build iOS on macOS runners.
11. Run React Native tests.
12. Run E2E tests on an emulator/device.
13. Sign release artifacts only in protected environments.

Cache Rust, Gradle, CocoaPods, and Yarn dependencies using keys that include lockfiles and toolchain versions.

## 14. Phase 11 — Incremental rollout

### Milestone A: Buildable React Native shell

Deliver the React Native project, Android host, navigation, theme, onboarding, and CI without deleting Kotlin.

Acceptance criteria:

- The React Native Android app launches using the existing application ID.
- Existing debug and release signing paths remain valid.
- Basic startup does not require Rust.

### Milestone B: Rust persistence behind React Native

Deliver the Rust crate, bridge, database schema, legacy Room migration, and workspace/thread/message operations.

Acceptance criteria:

- Existing Kotlin databases migrate successfully.
- Fixture records are preserved.
- React Native can browse and edit persisted data.

### Milestone C: Chat and provider execution

Deliver provider abstractions, streaming events, cancellation, chat persistence, and provider configuration.

Acceptance criteria:

- Mock provider tests pass deterministically.
- At least one real provider works end-to-end.
- Offline and invalid-credential states are explicit.

### Milestone D: Feature parity

Deliver documents, citations, agent steps, quick actions, export, storage inspector, GitHub integration, backup, biometrics, and voice input.

Acceptance criteria:

- The feature matrix shows parity with the Compose application.
- No production path depends on fake fallback data.

### Milestone E: Native Kotlin removal

Remove Compose dependencies, Room dependencies, Kotlin repositories/ViewModels, Kotlin UI components, Kotlin provider implementations, and Kotlin backup business logic.

Retain only minimal native adapter code required by React Native and platform APIs.

### Milestone F: Production rollout

Use staged distribution:

1. Internal debug builds
2. Internal release builds
3. Closed beta
4. Small production percentage
5. Full rollout

Monitor migration failures, startup crashes, Rust bridge failures, database corruption, provider errors, backup failures, ANRs, memory pressure, and native crashes.

## 15. Final repository layout

```text
.
├── android/
│   ├── app/
│   └── gradle/
├── ios/
├── rust/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   └── crates/
│       ├── vukko-core/
│       ├── vukko-db/
│       └── vukko-bridge/
├── src/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   ├── navigation/
│   ├── native/
│   ├── screens/
│   ├── services/
│   ├── store/
│   ├── theme/
│   ├── types/
│   └── utils/
├── tests/
│   ├── fixtures/
│   ├── e2e/
│   └── migration/
├── package.json
├── tsconfig.json
├── metro.config.js
└── babel.config.js
```

## 16. Key risks and mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Room-to-Rust migration loses data | Critical | Golden fixtures, transactional migration, retained database backup |
| Existing users cannot upgrade | Critical | Preserve application ID, signing key, database path, and versioning |
| Rust bridge instability | High | Typed TurboModule contract, request IDs, event ordering tests |
| Native background work is unreliable | High | Keep scheduling native and business logic in Rust |
| JavaScript number precision corrupts IDs/timestamps | High | Serialize IDs as strings and timestamps as strings or bounded integers |
| Fake fallback behavior reaches production | High | Separate mock and production services; explicit error contracts |
| React Native performance degrades on long chats | Medium | Virtualized lists, normalized state, incremental streaming updates |
| iOS scope expands unexpectedly | Medium | Isolate platform adapters and ship Android parity first |
| Kotlin and React Native implementations diverge | High | Feature matrix, contract tests, staged removal milestones |
| Native builds are not reproducible | High | Pin Node, Yarn, Rust, NDK, Gradle, CocoaPods, and Xcode |

## 17. Recommended implementation order

1. Freeze current behavior and capture database fixtures.
2. Add React Native project scaffolding without deleting Kotlin.
3. Create the Android React Native host while preserving the package ID.
4. Define TypeScript and Rust domain contracts.
5. Implement Rust database access and legacy Room migration.
6. Add the typed TurboModule bridge.
7. Port workspace, thread, and message flows.
8. Port chat streaming and provider abstractions.
9. Port UI screens and design tokens.
10. Add secure storage, biometrics, files, voice, backup, and widget adapters.
11. Add migration, Rust, React Native, native, and E2E test suites.
12. Replace existing CI with JavaScript/Rust/Android/iOS pipelines.
13. Run dual-implementation parity tests.
14. Remove Kotlin business logic and Compose/Room dependencies.
15. Roll out through staged release channels.

The highest-risk work is the Room-to-Rust database migration, followed by the streaming Rust-to-React Native bridge. Both should be implemented and validated before the UI rewrite is considered complete.
