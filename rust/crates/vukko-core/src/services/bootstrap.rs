//! First-run seeding.
//!
//! Reproduces `DataRepository.seedInitialSovereignData()` exactly: the same four
//! workspaces, five threads, eleven documents and four messages with their
//! stable ids, because existing installs already contain these rows and the
//! migration must not create duplicates next to them.
//!
//! Run only when `workspaces` is empty. The check and the inserts share one
//! transaction so two concurrent launches cannot both seed.

use rusqlite::Connection;

use crate::domain::{Citation, QueryMode, VukkoError, Workspace};
use crate::repository::message_repository;

/// Timestamp base for seeded rows: the seed is historical, not "now", so a
/// re-seed on a second device sorts identically.
const SEED_BASE: i64 = 1_700_000_000_000;

/// Seeds the database if it has no workspaces. Returns true when it seeded.
pub fn seed_if_empty(conn: &mut Connection) -> Result<bool, VukkoError> {
    let existing: i64 = conn.query_row("SELECT COUNT(*) FROM workspaces", [], |row| row.get(0))?;
    if existing > 0 {
        return Ok(false);
    }

    let transaction = conn.transaction()?;
    seed(&transaction)?;
    transaction.commit()?;
    Ok(true)
}

/// Inserts the shipped demo workspace set. Public so tests can stage a
/// known-populated database without touching the "is it empty" decision.
pub fn seed(conn: &Connection) -> Result<(), VukkoError> {
    let workspaces = seeded_workspaces();
    for workspace in &workspaces {
        conn.execute(
            "INSERT INTO workspaces (id, name, slug, description, systemPrompt, temperature, queryMode, \
             vectorCount, documentCount, createdAt, agentMaxSteps, agentAllowWebSearch, \
             agentAllowFileCreation, agentAllowDocumentSearch) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                workspace.id,
                workspace.name,
                workspace.slug,
                workspace.description,
                workspace.system_prompt,
                workspace.temperature,
                workspace.query_mode.as_wire(),
                workspace.vector_count,
                workspace.document_count,
                workspace.created_at,
                workspace.agent_max_steps,
                i64::from(workspace.agent_allow_web_search),
                i64::from(workspace.agent_allow_file_creation),
                i64::from(workspace.agent_allow_document_search),
            ],
        )?;
    }

    for (id, workspace_id, name, slug, message_count) in seeded_threads() {
        conn.execute(
            "INSERT INTO chat_threads (id, workspaceId, name, slug, createdAt, updatedAt, messageCount, \
             lastMessageSnippet, isPinned) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, NULL, 0)",
            rusqlite::params![id, workspace_id, name, slug, SEED_BASE, message_count],
        )?;
    }

    for document in seeded_documents() {
        conn.execute(
            "INSERT INTO workspace_documents (id, workspaceId, name, type, size, vectorCount, \
             contentSummary, fullContent, dateAdded) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                document.id,
                document.workspace_id,
                document.name,
                document.document_type,
                document.size,
                document.vector_count,
                document.summary,
                document.content,
                SEED_BASE,
            ],
        )?;
    }

    let greeting = Citation {
        title: "vukko-getting-started.pdf".into(),
        source: "Section 1.1".into(),
        snippet: "Vukko is a full-stack AI application engineered for privacy and local data sovereignty..."
            .into(),
        score: 0.95,
    };

    message_repository::append(
        conn,
        "th_default",
        &message_repository::NewMessage {
            sender: Some(crate::domain::MessageSender::USER),
            content: "Hi! Can you tell me what Vukko is and how it guarantees data sovereignty?"
                .into(),
            timestamp: Some(SEED_BASE - 120_000),
            ..Default::default()
        },
    )?;

    message_repository::append(
        conn,
        "th_default",
        &message_repository::NewMessage {
            sender: Some(crate::domain::MessageSender::ASSISTANT),
            content: "Welcome to **Vukko Mobile**!\n\nVukko is the **all-in-one AI client and knowledge \
workspace** engineered with **complete local data sovereignty**:\n\n* **Local sovereign storage**: all \
chat history, threads and document knowledge bases live in the on-device SQLite database \
(`vukko_sovereign.db`).\n* **Autonomous agent**: complex goals are broken into multi-step pipelines.\n\
* **Document RAG & citations**: chat with local PDFs and notes.\n* **Flexible providers**: Gemini, \
OpenAI, Claude, DeepSeek, Groq or a self-hosted Ollama instance."
                .into(),
            timestamp: Some(SEED_BASE - 110_000),
            thinking: Some(
                "User requested a Vukko architecture overview with focus on data sovereignty.".into(),
            ),
            thinking_duration_ms: Some(1_180),
            citations: vec![greeting],
            ..Default::default()
        },
    )?;

    message_repository::append(
        conn,
        "th_agent",
        &message_repository::NewMessage {
            sender: Some(crate::domain::MessageSender::USER),
            content: "Research multi-step autonomous agent architectures, contrast with simple \
prompt-response RAG, and save an executive report to this workspace."
                .into(),
            timestamp: Some(SEED_BASE - 300_000),
            ..Default::default()
        },
    )?;

    message_repository::append(
        conn,
        "th_agent",
        &message_repository::NewMessage {
            sender: Some(crate::domain::MessageSender::ASSISTANT),
            content: "### Autonomous task complete\n\nThe agent planned, gathered context and saved a \
deliverable report to this workspace."
                .into(),
            timestamp: Some(SEED_BASE - 280_000),
            is_agent_execution: true,
            agent_steps: vec![
                crate::domain::AgentStep {
                    step_index: 1,
                    title: "Goal planning & decomposition".into(),
                    description: "Parse the objective and schedule a tool pipeline.".into(),
                    tool_name: "Planner".into(),
                    status: crate::domain::AgentStepStatus::COMPLETED,
                    tool_input: Some("Goal: research autonomous agent architectures".into()),
                    tool_output: Some("Decomposed into 4 sub-tasks with verification gates.".into()),
                    execution_time_ms: Some(420),
                },
                crate::domain::AgentStep {
                    step_index: 2,
                    title: "Workspace knowledge base search".into(),
                    description: "Query local embeddings in the agent workspace.".into(),
                    tool_name: "DocumentRAG".into(),
                    status: crate::domain::AgentStepStatus::COMPLETED,
                    tool_input: Some("agent orchestration".into()),
                    tool_output: Some("Found 2 relevant fragments.".into()),
                    execution_time_ms: Some(610),
                },
            ],
            created_document_id: Some("doc_agent_created_1".into()),
            created_document_name: Some("agent_artifact_autonomous_architecture.md".into()),
            citations: vec![Citation {
                title: "agent-orchestration-specs.md".into(),
                source: "Section 2.3".into(),
                snippet: "Agents execute in a continuous feedback loop: Perceive -> Plan -> Act -> Reflect."
                    .into(),
                score: 0.96,
            }],
            ..Default::default()
        },
    )?;

    Ok(())
}

/// The four demo workspaces, verbatim from `seedInitialSovereignData`.
pub fn seeded_workspaces() -> Vec<Workspace> {
    vec![
        Workspace {
            id: "ws_default".into(),
            name: "Default Workspace".into(),
            slug: "default-workspace".into(),
            description: "General purpose conversational AI assistant".into(),
            system_prompt:
                "You are Vukko, an intelligent, privacy-first AI assistant. You provide \
thoughtful, precise answers and detailed explanations."
                    .into(),
            temperature: 0.7,
            query_mode: QueryMode::CHAT,
            vector_count: 28,
            document_count: 2,
            created_at: SEED_BASE,
            agent_max_steps: 5,
            agent_allow_web_search: true,
            agent_allow_file_creation: true,
            agent_allow_document_search: true,
        },
        Workspace {
            id: "ws_dev".into(),
            name: "Engineering & Code".into(),
            slug: "engineering-code".into(),
            description: "Coding assistant with syntax support, refactoring & debugging".into(),
            system_prompt:
                "You are a senior staff software engineer. Provide high-quality Kotlin, \
TypeScript, and architectural patterns. Write clean, idiomatic code with concise explanations."
                    .into(),
            temperature: 0.2,
            query_mode: QueryMode::CHAT,
            vector_count: 64,
            document_count: 3,
            created_at: SEED_BASE,
            agent_max_steps: 5,
            agent_allow_web_search: true,
            agent_allow_file_creation: true,
            agent_allow_document_search: true,
        },
        Workspace {
            id: "ws_research".into(),
            name: "Knowledge Base (RAG)".into(),
            slug: "knowledge-base-rag".into(),
            description: "Document-grounded question answering with citations".into(),
            system_prompt:
                "You are a research analyst. Use retrieved document fragments to answer \
user questions. Always reference sources and state confidence."
                    .into(),
            temperature: 0.3,
            query_mode: QueryMode::QUERY,
            vector_count: 112,
            document_count: 4,
            created_at: SEED_BASE,
            agent_max_steps: 5,
            agent_allow_web_search: true,
            agent_allow_file_creation: true,
            agent_allow_document_search: true,
        },
        Workspace {
            id: "ws_agent".into(),
            name: "Autonomous Agent Hub".into(),
            slug: "autonomous-agent-hub".into(),
            description:
                "Multi-step autonomous agent with planning, tool calling & document creation".into(),
            system_prompt:
                "You are an autonomous AI agent capable of breaking complex objectives down \
into executable tasks. Use available tools to plan, verify, and complete deliverables."
                    .into(),
            temperature: 0.4,
            query_mode: QueryMode::AGENT,
            vector_count: 76,
            document_count: 2,
            created_at: SEED_BASE,
            agent_max_steps: 6,
            agent_allow_web_search: true,
            agent_allow_file_creation: true,
            agent_allow_document_search: true,
        },
    ]
}

fn seeded_threads() -> Vec<(&'static str, &'static str, &'static str, &'static str, u32)> {
    vec![
        (
            "th_default",
            "ws_default",
            "General Discussion",
            "general-discussion",
            2,
        ),
        (
            "th_notes",
            "ws_default",
            "Project Ideas & Brainstorm",
            "project-ideas",
            0,
        ),
        (
            "th_agent",
            "ws_agent",
            "Autonomous Multi-Step Tasks",
            "autonomous-tasks",
            2,
        ),
        (
            "th_dev_compose",
            "ws_dev",
            "Android Jetpack Compose Migration",
            "compose-migration",
            0,
        ),
        (
            "th_research_rag",
            "ws_research",
            "Architecture Whitepaper Q&A",
            "whitepaper-qa",
            0,
        ),
    ]
}

struct SeedDocument {
    id: &'static str,
    workspace_id: &'static str,
    name: &'static str,
    document_type: &'static str,
    size: &'static str,
    vector_count: u32,
    summary: &'static str,
    content: &'static str,
}

fn seeded_documents() -> Vec<SeedDocument> {
    vec![
        SeedDocument { id: "doc_1", workspace_id: "ws_default", name: "vukko-getting-started.pdf", document_type: "PDF", size: "420 KB", vector_count: 16, summary: "Comprehensive setup guide for desktop and mobile clients.", content: "Vukko setup guide." },
        SeedDocument { id: "doc_2", workspace_id: "ws_default", name: "quick-context-actions.md", document_type: "MARKDOWN", size: "18 KB", vector_count: 12, summary: "Instructions for text selection processing and assistant integration.", content: "Quick context actions." },
        SeedDocument { id: "doc_agent_1", workspace_id: "ws_agent", name: "agent-orchestration-specs.md", document_type: "MARKDOWN", size: "28 KB", vector_count: 32, summary: "Autonomous multi-agent execution loop, DAG task scheduler, and tool sandbox constraints.", content: "Agents execute in a continuous feedback loop: Perceive -> Plan -> Act -> Reflect." },
        SeedDocument { id: "doc_agent_2", workspace_id: "ws_agent", name: "tool-calling-protocols.json", document_type: "TEXT", size: "16 KB", vector_count: 44, summary: "Standardized JSON schemas for WebSearch, DocumentRAG, FileCreator, and Calculator.", content: "{}" },
        SeedDocument { id: "doc_3", workspace_id: "ws_dev", name: "kotlin-clean-architecture.md", document_type: "MARKDOWN", size: "54 KB", vector_count: 28, summary: "Best practices for M3 Compose, StateFlow and Repository patterns.", content: "Clean architecture notes." },
        SeedDocument { id: "doc_4", workspace_id: "ws_dev", name: "vector-embeddings-schema.json", document_type: "TEXT", size: "12 KB", vector_count: 14, summary: "ObjectBox and vector chunking serialization formats.", content: "{}" },
        SeedDocument { id: "doc_5", workspace_id: "ws_dev", name: "api-endpoints.txt", document_type: "TEXT", size: "8 KB", vector_count: 22, summary: "REST and WebSocket endpoints for Vukko backend.", content: "GET /health" },
        SeedDocument { id: "doc_6", workspace_id: "ws_research", name: "vukko_whitepaper_v2.pdf", document_type: "PDF", size: "1.8 MB", vector_count: 48, summary: "Deep dive into local LLM orchestration and hybrid RAG.", content: "Whitepaper." },
        SeedDocument { id: "doc_7", workspace_id: "ws_research", name: "security_model_and_privacy.pdf", document_type: "PDF", size: "640 KB", vector_count: 32, summary: "Data isolation and air-gapped on-device AI inference.", content: "Security model." },
        SeedDocument { id: "doc_8", workspace_id: "ws_research", name: "rag_chunking_strategies.md", document_type: "MARKDOWN", size: "35 KB", vector_count: 18, summary: "Recursive character splitting vs semantic chunking benchmarks.", content: "Chunking." },
        SeedDocument { id: "doc_9", workspace_id: "ws_research", name: "web_scraping_policy.txt", document_type: "TEXT", size: "14 KB", vector_count: 14, summary: "Robots.txt compliance and html-to-markdown sanitation.", content: "Policy." },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::{message_repository, thread_repository, workspace_repository};
    use rusqlite::Connection;

    fn fresh() -> (Connection, std::path::PathBuf) {
        use std::sync::atomic::{AtomicU64, Ordering};

        // Unique per call, not merely per millisecond: these tests run in
        // parallel and two of them starting in the same tick would share a file.
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let mut path = std::env::temp_dir();
        path.push(format!(
            "vukko-bootstrap-{}-{}-{}.db",
            std::process::id(),
            crate::repository::now_millis(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_file(&path);
        let (conn, _) = vukko_db::adopt(&path).expect("adopt");
        (conn, path)
    }

    #[test]
    fn seeding_creates_the_shipped_demo_set() {
        let (mut conn, path) = fresh();
        assert!(seed_if_empty(&mut conn).unwrap());

        let workspaces = workspace_repository::list(&conn).unwrap();
        let ids: Vec<&str> = workspaces
            .iter()
            .map(|workspace| workspace.id.as_str())
            .collect();
        assert_eq!(ids, vec!["ws_default", "ws_dev", "ws_research", "ws_agent"]);

        let threads = thread_repository::list(&conn, "ws_default").unwrap();
        assert_eq!(threads.len(), 2);
        assert_eq!(threads[0].message_count, 2);

        let messages = message_repository::list(&conn, "th_default").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].citations.len(), 1);

        let agent_messages = message_repository::list(&conn, "th_agent").unwrap();
        assert!(agent_messages[1].is_agent_execution);
        assert_eq!(agent_messages[1].agent_steps.len(), 2);

        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn seeding_is_skipped_when_data_exists() {
        let (mut conn, path) = fresh();
        assert!(seed_if_empty(&mut conn).unwrap());
        assert!(!seed_if_empty(&mut conn).unwrap());

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM workspaces", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 4);
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn seeded_counts_are_consistent_after_seeding() {
        let (mut conn, path) = fresh();
        seed_if_empty(&mut conn).unwrap();
        let summary = crate::repository::storage_repository::row_counts(&conn).unwrap();
        assert_eq!(summary.workspaces, 4);
        assert_eq!(summary.threads, 5);
        assert_eq!(summary.messages, 4);
        assert_eq!(summary.documents, 11);
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }
}
