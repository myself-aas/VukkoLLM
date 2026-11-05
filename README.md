# AnythingLLM Android (Native Jetpack Compose)

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
