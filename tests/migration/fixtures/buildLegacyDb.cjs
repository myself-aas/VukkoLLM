// Builds legacy Room-format SQLite databases for migration tests.
//
// Usage (from the repository root):
//   node tests/migration/fixtures/buildLegacyDb.cjs <fixture-name> <output.db>
//   node tests/migration/fixtures/buildLegacyDb.cjs --list
//
// The fixtures are generated, not committed, so no binary blobs enter git.
// Every fixture is created with the DDL in legacy_room_v1.sql so the schema
// under test is always the one written down as the compatibility contract.
//
// Fixtures:
//   empty            schema only, no rows
//   workspace_only   one workspace, nothing else
//   nested           two workspaces, threads and ordered messages
//   rich             the full seed shape of DataRepository.seedInitialSovereignData
//                    plus citations, attachments, agent steps, tags, favorites
//   corrupted        a database whose chat_messages page is truncated
//   partial          a database missing the room_master_table (half-written)

const { readFileSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const here = __dirname;
const LEGACY_DDL = readFileSync(join(here, 'legacy_room_v1.sql'), 'utf8');

/** Timestamp used by every fixture so orderings are deterministic. */
const BASE_TIMESTAMP = 1_700_000_000_000;

const workspaces = [
  {
    id: 'ws_default',
    name: 'Default Workspace',
    slug: 'default-workspace',
    description: 'General purpose conversational AI assistant',
    systemPrompt:
      'You are Vukko, an intelligent, privacy-first AI assistant. You provide thoughtful, precise answers and detailed explanations.',
    temperature: 0.7,
    queryMode: 'CHAT',
    vectorCount: 28,
    documentCount: 2,
    createdAt: BASE_TIMESTAMP,
    agentMaxSteps: 5,
    agentAllowWebSearch: 1,
    agentAllowFileCreation: 1,
    agentAllowDocumentSearch: 1,
  },
  {
    id: 'ws_agent',
    name: 'Autonomous Agent Hub',
    slug: 'autonomous-agent-hub',
    description: 'Multi-step autonomous agent with planning, tool calling & document creation',
    systemPrompt:
      'You are an autonomous AI agent capable of breaking complex objectives down into executable tasks.',
    temperature: 0.4,
    queryMode: 'AGENT',
    vectorCount: 76,
    documentCount: 2,
    createdAt: BASE_TIMESTAMP + 1_000,
    agentMaxSteps: 6,
    agentAllowWebSearch: 1,
    agentAllowFileCreation: 1,
    agentAllowDocumentSearch: 0,
  },
];

const threads = [
  {
    id: 'th_default',
    workspaceId: 'ws_default',
    name: 'General Discussion',
    slug: 'general-discussion',
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP + 120_000,
    messageCount: 2,
    lastMessageSnippet: 'Welcome to **Vukko Mobile**!',
    isPinned: 0,
  },
  {
    id: 'th_notes',
    workspaceId: 'ws_default',
    name: 'Project Ideas & Brainstorm',
    slug: 'project-ideas',
    createdAt: BASE_TIMESTAMP + 500,
    updatedAt: BASE_TIMESTAMP + 500,
    messageCount: 0,
    lastMessageSnippet: null,
    isPinned: 1,
  },
  {
    id: 'th_agent',
    workspaceId: 'ws_agent',
    name: 'Autonomous Multi-Step Tasks',
    slug: 'autonomous-tasks',
    createdAt: BASE_TIMESTAMP + 2_000,
    updatedAt: BASE_TIMESTAMP + 300_000,
    messageCount: 2,
    lastMessageSnippet: 'Autonomous Task Complete',
    isPinned: 0,
  },
];

const messages = [
  {
    id: 'msg_1',
    threadId: 'th_default',
    sender: 'USER',
    content: 'Hi! Can you tell me what Vukko is and how it guarantees data sovereignty?',
    timestamp: BASE_TIMESTAMP,
    thinking: null,
    thinkingDurationMs: null,
    citationsJson: '[]',
    toolsUsedJson: '[]',
    attachmentsJson: '[]',
    isStreaming: 0,
    isAgentExecution: 0,
    agentStepsJson: '[]',
    createdDocumentId: null,
    createdDocumentName: null,
    isFavorite: 0,
    isPinned: 0,
    tagsJson: '[]',
  },
  {
    id: 'msg_2',
    threadId: 'th_default',
    sender: 'ASSISTANT',
    content:
      'Welcome to **Vukko Mobile**!\n\nVukko stores everything in `vukko_sovereign.db`.\n\n```kotlin\nval db = "local"\n```',
    timestamp: BASE_TIMESTAMP + 10_000,
    thinking: 'User requested Vukko architecture overview with focus on data sovereignty.',
    thinkingDurationMs: 1180,
    citationsJson: JSON.stringify([
      {
        title: 'vukko-getting-started.pdf',
        source: 'Section 1.1',
        snippet: 'Vukko is a full-stack AI application engineered for privacy.',
        score: 0.95,
      },
    ]),
    toolsUsedJson: JSON.stringify([
      {
        toolName: 'DocumentRAG',
        description: 'Local knowledge base search',
        input: 'data sovereignty',
        output: '1 fragment',
        isSuccess: true,
      },
    ]),
    attachmentsJson: JSON.stringify([
      {
        id: 'att_1',
        name: 'screenshot.png',
        mimeType: 'image/png',
        sizeDisplay: '184 KB',
        previewText: null,
      },
    ]),
    isStreaming: 0,
    isAgentExecution: 0,
    agentStepsJson: '[]',
    createdDocumentId: null,
    createdDocumentName: null,
    isFavorite: 1,
    isPinned: 0,
    tagsJson: JSON.stringify(['welcome', 'privacy']),
  },
  {
    id: 'msg_agent_1',
    threadId: 'th_agent',
    sender: 'USER',
    content: 'Research multi-step autonomous agent architectures and save a report.',
    timestamp: BASE_TIMESTAMP + 200_000,
    thinking: null,
    thinkingDurationMs: null,
    citationsJson: '[]',
    toolsUsedJson: '[]',
    attachmentsJson: '[]',
    isStreaming: 0,
    isAgentExecution: 0,
    agentStepsJson: '[]',
    createdDocumentId: null,
    createdDocumentName: null,
    isFavorite: 0,
    isPinned: 0,
    tagsJson: '[]',
  },
  {
    id: 'msg_agent_2',
    threadId: 'th_agent',
    sender: 'ASSISTANT',
    content: '### Autonomous Task Complete\n\nSaved the report to the workspace.',
    timestamp: BASE_TIMESTAMP + 220_000,
    thinking: null,
    thinkingDurationMs: null,
    citationsJson: JSON.stringify([
      {
        title: 'agent-orchestration-specs.md',
        source: 'Section 2.3',
        snippet: 'Agents execute in a continuous feedback loop.',
        score: 0.96,
      },
    ]),
    toolsUsedJson: '[]',
    attachmentsJson: '[]',
    isStreaming: 0,
    isAgentExecution: 1,
    agentStepsJson: JSON.stringify([
      {
        stepIndex: 1,
        title: 'Goal Planning & Decomposition',
        description: 'Parse user objective and schedule multi-tool pipeline.',
        toolName: 'Planner',
        status: 'COMPLETED',
        toolInput: 'Goal: Research autonomous agent architectures',
        toolOutput: 'Decomposed into 4 sub-tasks with verification gates.',
        executionTimeMs: 420,
      },
      {
        stepIndex: 2,
        title: 'Workspace Knowledge Base Search',
        description: 'Query local vector embeddings.',
        toolName: 'DocumentRAG',
        status: 'COMPLETED',
        toolInput: 'agent orchestration',
        toolOutput: 'Found 2 relevant fragments',
        executionTimeMs: 610,
      },
    ]),
    createdDocumentId: 'doc_agent_created_1',
    createdDocumentName: 'agent_artifact_autonomous_architecture.md',
    isFavorite: 0,
    isPinned: 1,
    tagsJson: JSON.stringify(['agent']),
  },
];

const documents = [
  {
    id: 'doc_1',
    workspaceId: 'ws_default',
    name: 'vukko-getting-started.pdf',
    type: 'PDF',
    size: '420 KB',
    vectorCount: 16,
    contentSummary: 'Comprehensive setup guide for desktop and mobile clients.',
    fullContent: 'Vukko setup guide body.',
    dateAdded: BASE_TIMESTAMP,
  },
  {
    id: 'doc_agent_1',
    workspaceId: 'ws_agent',
    name: 'agent-orchestration-specs.md',
    type: 'MARKDOWN',
    size: '28 KB',
    vectorCount: 32,
    contentSummary: 'Autonomous multi-agent execution loop and tool sandbox constraints.',
    fullContent:
      'Agents execute in a continuous feedback loop: Perceive -> Plan -> Act -> Reflect.',
    dateAdded: BASE_TIMESTAMP + 3_000,
  },
  {
    id: 'doc_blank',
    workspaceId: 'ws_agent',
    name: 'web-link-without-body',
    type: 'WEB_LINK',
    size: '0 KB',
    vectorCount: 0,
    contentSummary: '',
    fullContent: '',
    dateAdded: BASE_TIMESTAMP + 4_000,
  },
];

function openFresh(path) {
  rmSync(path, { force: true });
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(LEGACY_DDL);
  return db;
}

function insertAll(db, table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const statement = db.prepare(
    `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) ` +
      `VALUES (${columns.map(() => '?').join(', ')})`,
  );
  for (const row of rows) {
    statement.run(...columns.map((c) => row[c]));
  }
}

const builders = {
  empty(path) {
    openFresh(path).close();
  },

  workspace_only(path) {
    const db = openFresh(path);
    insertAll(db, 'workspaces', [workspaces[0]]);
    db.close();
  },

  nested(path) {
    const db = openFresh(path);
    insertAll(db, 'workspaces', workspaces);
    insertAll(db, 'chat_threads', threads);
    insertAll(db, 'chat_messages', messages);
    db.close();
  },

  rich(path) {
    const db = openFresh(path);
    insertAll(db, 'workspaces', workspaces);
    insertAll(db, 'chat_threads', threads);
    insertAll(db, 'chat_messages', messages);
    insertAll(db, 'workspace_documents', documents);
    db.close();
  },

  // A real page-level corruption: valid header, but the b-tree root page of
  // chat_messages is overwritten with garbage, so reading the table raises
  // SQLITE_CORRUPT ("database disk image is malformed") instead of silently
  // returning partial data. Root pages are read from sqlite_master rather than
  // assumed, because creation order does not determine them.
  corrupted(path) {
    const db = openFresh(path);
    insertAll(db, 'workspaces', workspaces);
    insertAll(db, 'chat_threads', threads);
    insertAll(db, 'chat_messages', messages);
    const { rootpage: rootPage } = db
      .prepare("SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'chat_messages'")
      .get();
    db.close();

    const buffer = readFileSync(path);
    const pageSize = buffer.readUInt16BE(16) || 4096;
    const offset = pageSize * (rootPage - 1);
    buffer.fill(0xff, offset, Math.min(offset + pageSize, buffer.length));
    writeFileSync(path, buffer);
  },

  // Half-written database: schema and rows exist but Room's bookkeeping table
  // was never created, which is what an interrupted first migration leaves.
  partial(path) {
    const db = openFresh(path);
    insertAll(db, 'workspaces', workspaces);
    db.exec('DROP TABLE room_master_table;');
    db.close();
  },
};

function buildFixture(name, path) {
  const builder = builders[name];
  if (!builder) {
    throw new Error(`unknown fixture: ${name} (known: ${Object.keys(builders).join(', ')})`);
  }
  builder(path);
  return path;
}

const FIXTURE_NAMES = Object.keys(builders);

module.exports = { buildFixture, FIXTURE_NAMES, BASE_TIMESTAMP, LEGACY_DDL };

if (require.main === module) {
  const [name, out] = process.argv.slice(2);
  if (name === '--list' || !name || !out) {
    console.log(FIXTURE_NAMES.join('\n'));
    process.exit(name === '--list' ? 0 : 2);
  }
  buildFixture(name, out);
  console.log(`wrote ${name} fixture to ${out}`);
}
