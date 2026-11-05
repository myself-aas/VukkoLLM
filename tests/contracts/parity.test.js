/**
 * Bidirectional parity between the TypeScript domain contracts and the Rust
 * domain modules (MIGRATION_PLAN.md §5 Step 2.1).
 *
 * The manifest below is the contract: it is written against the TS declarations
 * in src/types/*.ts, parsed out of the Rust sources, and compared in both
 * directions. Adding a field to either side therefore fails here until the other
 * side and the manifest agree.
 */

const { readFileSync, existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const repoRoot = join(__dirname, '..', '..');
const rustDomainDir = join(repoRoot, 'rust', 'crates', 'vukko-core', 'src', 'domain');

/** Contract manifest: TS type name → ordered field names (camelCase wire form). */
const MANIFEST = {
  Citation: ['title', 'source', 'snippet', 'score'],
  ToolCall: ['toolName', 'description', 'input', 'output', 'isSuccess'],
  MessageAttachment: ['id', 'name', 'mimeType', 'sizeDisplay', 'previewText'],
  AgentStep: [
    'stepIndex',
    'title',
    'description',
    'toolName',
    'status',
    'toolInput',
    'toolOutput',
    'executionTimeMs',
  ],
  ChatMessage: [
    'id',
    'threadId',
    'sender',
    'content',
    'timestamp',
    'thinking',
    'thinkingDurationMs',
    'citations',
    'toolsUsed',
    'attachments',
    'isStreaming',
    'isAgentExecution',
    'agentSteps',
    'createdDocumentId',
    'createdDocumentName',
    'isFavorite',
    'isPinned',
    'tags',
  ],
  Workspace: [
    'id',
    'name',
    'slug',
    'description',
    'systemPrompt',
    'temperature',
    'queryMode',
    'vectorCount',
    'documentCount',
    'createdAt',
    'agentMaxSteps',
    'agentAllowWebSearch',
    'agentAllowFileCreation',
    'agentAllowDocumentSearch',
  ],
  WorkspaceThread: [
    'id',
    'workspaceId',
    'name',
    'slug',
    'createdAt',
    'updatedAt',
    'messageCount',
    'lastMessageSnippet',
    'isPinned',
  ],
  DocumentItem: [
    'id',
    'workspaceId',
    'name',
    'type',
    'size',
    'vectorCount',
    'contentSummary',
    'fullContent',
    'dateAdded',
  ],
  LLMModel: ['id', 'name', 'provider', 'contextWindow', 'supportsVision', 'supportsReasoning'],
  ProviderConfig: [
    'provider',
    'apiKey',
    'baseUrl',
    'selectedModelId',
    'temperature',
    'maxTokens',
    'isConnected',
  ],
  SovereignStorageStats: [
    'databaseName',
    'totalWorkspaces',
    'totalThreads',
    'totalMessages',
    'totalDocuments',
    'isLocalEncrypted',
    'storageType',
    'dataSovereigntyStatus',
  ],
  GitHubRepository: [
    'id',
    'name',
    'fullName',
    'owner',
    'description',
    'isPrivate',
    'defaultBranch',
    'starsCount',
    'forksCount',
    'openIssuesCount',
    'updatedAt',
    'cloneUrl',
    'htmlUrl',
  ],
  GitHubCommit: ['sha', 'message', 'authorName', 'authorEmail', 'date', 'htmlUrl'],
  GitHubBranch: ['name', 'commitSha', 'isProtected'],
  GitHubPullRequest: [
    'id',
    'number',
    'title',
    'body',
    'state',
    'headBranch',
    'baseBranch',
    'author',
    'htmlUrl',
    'createdAt',
  ],
  VukkoError: ['code', 'message', 'retryable', 'details'],
  TableCount: ['table', 'rows'],
  IntegrityCheckResult: [
    'ok',
    'integrityCheck',
    'foreignKeyViolations',
    'backupPresent',
    'tableCounts',
    'checkedAt',
  ],
  AgentStepRecord: [
    'stepIndex',
    'title',
    'description',
    'toolName',
    'status',
    'toolInput',
    'toolOutput',
    'executionTimeMs',
  ],
  AgentExecution: ['messageId', 'steps', 'startedAt', 'finishedAt', 'status'],
  BackupSettings: [
    'enabled',
    'frequencyHours',
    'target',
    'repository',
    'cloudBucket',
    'lastBackupTimestamp',
  ],
  BackupResult: ['status', 'fileName', 'workspaceCount', 'checksum', 'completedAt', 'reason'],
};

/** Enum wire values, taken from the Kotlin enums so the wire format cannot drift. */
const ENUMS = {
  MessageSender: ['USER', 'ASSISTANT', 'SYSTEM'],
  QueryMode: ['CHAT', 'QUERY', 'AGENT'],
  DocumentType: ['TEXT', 'PDF', 'WEB_LINK', 'MARKDOWN'],
  ProviderType: ['GEMINI', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'GROQ', 'OLLAMA', 'INSTANCE'],
  AgentStepStatus: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'],
  PRState: ['OPEN', 'CLOSED', 'MERGED'],
  SchemaOwnership: ['NONE', 'LEGACY_ROOM', 'RUST', 'MIGRATING'],
  BackupTarget: ['GITHUB', 'CLOUD_BUCKET'],
  BackupTrigger: ['SCHEDULED', 'MANUAL'],
  BackupStatus: ['COMPLETED', 'FAILED', 'UNSUPPORTED'],
  GitHubAuthStatus: [
    'UNLINKED',
    'REQUESTING_CODE',
    'CODE_RECEIVED',
    'POLLING_TOKEN',
    'CONNECTED',
    'ERROR',
  ],
  AgentToolName: ['Planner', 'DocumentRAG', 'WebSearch', 'FileCreator', 'DataSynthesizer'],
  ErrorCode: [
    'NOT_INITIALIZED',
    'NOT_FOUND',
    'VALIDATION',
    'NETWORK',
    'AUTHENTICATION',
    'STORAGE',
    'CANCELLED',
    'UNSUPPORTED',
  ],
};

function rustFile(name) {
  return join(rustDomainDir, name);
}

function readRustDomain() {
  if (!existsSync(rustDomainDir)) return null;
  const files = readdirSync(rustDomainDir).filter((file) => file.endsWith('.rs'));
  const combined = files.map((file) => readFileSync(join(rustDomainDir, file), 'utf8')).join('\n');
  return { files, combined };
}

/** Extracts `pub struct Name { field: Type, ... }` field lists, camelCased. */
function parseRustStructs(source) {
  const structs = {};
  const structPattern = /pub struct (\w+)\s*\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = structPattern.exec(source)) !== null) {
    const [, name, body] = match;
    const fields = [];
    const lines = body.split('\n');
    // A `#[serde(rename = "...")]` on the line(s) before a field wins over the
    // camelCase conversion, matching what serde itself does.
    let pendingRename = null;
    for (const line of lines) {
      const renameMatch = line.match(/#\[serde\(rename = "([^"]+)"\)\]/);
      if (renameMatch) {
        pendingRename = renameMatch[1];
        continue;
      }
      const fieldMatch = line.match(/^\s*(?:pub\s+)?([a-z_][a-z0-9_]*)\s*:\s*(.+?),?\s*$/);
      if (!fieldMatch) continue;
      const [, rustName, type] = fieldMatch;
      if (rustName.startsWith('_')) continue;
      fields.push({ name: pendingRename ?? toCamel(rustName), rustName, type: type.trim() });
      pendingRename = null;
    }
    structs[name] = fields;
  }
  return structs;
}

/**
 * Extracts `pub enum Name { Variant, ... }` and reports *wire* variant names:
 * a SCREAMING_SNAKE_CASE enum serialises `Planner` as `"PLANNER"` only if the
 * variant itself is upper case, so both cases are preserved here and compared
 * against the Kotlin source rather than assumed.
 */
function parseRustEnums(source) {
  const enums = {};
  const pattern = /((?:#\[[^\n]*\]\n)*)pub enum (\w+)\s*\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const [, attributes, name, body] = match;
    const scream = attributes.includes('SCREAMING_SNAKE_CASE');
    const variants = [];
    let pendingRename = null;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      const renameMatch = line.match(/#\[serde\(rename = "([^"]+)"\)\]/);
      if (renameMatch) {
        pendingRename = renameMatch[1];
        continue;
      }
      if (!/^[A-Z][A-Za-z0-9_]*(,|\s*=|$)/.test(line)) continue;
      const variant = line.split(/[,\s=]/)[0];
      if (!variant) continue;
      variants.push(pendingRename ?? (scream ? variant.toUpperCase() : variant));
      pendingRename = null;
    }
    enums[name] = variants;
  }
  return enums;
}

function toCamel(snake) {
  return snake.replace(/_([a-z0-9])/g, (_all, chr) => chr.toUpperCase());
}

describe('Rust domain modules exist', () => {
  test('rust/crates/vukko-core/src/domain holds the contract modules', () => {
    const rust = readRustDomain();
    expect(rust).not.toBeNull();
    expect(rust.files.sort()).toEqual(
      expect.arrayContaining([
        'agent.rs',
        'backup.rs',
        'chat.rs',
        'document.rs',
        'error.rs',
        'github.rs',
        'mod.rs',
        'provider.rs',
        'storage.rs',
        'workspace.rs',
      ]),
    );
  });
});

describe('struct parity', () => {
  test('every manifest type has a Rust struct and a TS declaration', () => {
    const rust = readRustDomain();
    const structs = parseRustStructs(rust.combined);
    const tsSources = readdirSync(join(repoRoot, 'src', 'types'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(join(repoRoot, 'src', 'types', file), 'utf8'))
      .join('\n');

    const missingRust = Object.keys(MANIFEST).filter((name) => !structs[name]);
    const missingTs = Object.keys(MANIFEST).filter(
      (name) =>
        !new RegExp(`export (interface|type) ${name}\\b`).test(tsSources) &&
        !new RegExp(`export type ${name}\\b`).test(tsSources),
    );

    expect({ missingRust, missingTs }).toEqual({ missingRust: [], missingTs: [] });
  });

  test.each(Object.entries(MANIFEST))(
    '%s has identical field sets on both sides',
    (name, fields) => {
      const rust = readRustDomain();
      const structs = parseRustStructs(rust.combined);
      const rustFields = structs[name].map((field) => field.name);

      expect(rustFields).toEqual(fields);
    },
  );

  test.each(Object.entries(MANIFEST))('%s TS declaration lists the same fields', (name, fields) => {
    const tsSource = readdirSync(join(repoRoot, 'src', 'types'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(join(repoRoot, 'src', 'types', file), 'utf8'))
      .join('\n');

    const declaration = extractTsDeclaration(tsSource, name);
    expect(declaration).not.toBeNull();

    const tsFields = [...declaration.matchAll(/^\s{2}([a-zA-Z_][a-zA-Z0-9_]*)(\?)?:/gm)].map(
      (match) => match[1],
    );
    expect(tsFields).toEqual(fields);
  });
});

describe('enum parity', () => {
  test('Rust enums carry the Kotlin wire values in the same order', () => {
    const rust = readRustDomain();
    const enums = parseRustEnums(rust.combined);

    for (const [name, variants] of Object.entries(ENUMS)) {
      expect({ name, variants: enums[name] }).toEqual({ name, variants });
    }
  });

  test('has no Rust enum that TypeScript does not declare', () => {
    const rust = readRustDomain();
    const enums = parseRustEnums(rust.combined);
    const tsSource = readdirSync(join(repoRoot, 'src', 'types'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(join(repoRoot, 'src', 'types', file), 'utf8'))
      .join('\n');

    const undeclared = Object.keys(enums).filter(
      (name) => !new RegExp(`export type ${name}\\b`).test(tsSource),
    );
    expect(undeclared).toEqual([]);
  });
});

describe('serialisation rules', () => {
  test('every Rust struct serialises to camelCase', () => {
    const rust = readRustDomain();
    const offenders = [];
    const pattern = /((?:#\[[^\n]*\]\n)*)pub struct (\w+)/g;
    let match;
    while ((match = pattern.exec(rust.combined)) !== null) {
      const [, attributes, name] = match;
      if (!attributes.includes('rename_all = "camelCase"')) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  test('every Rust enum serialises to SCREAMING_SNAKE_CASE', () => {
    const rust = readRustDomain();
    const offenders = [];
    const pattern = /((?:#\[[^\n]*\]\n)*)pub enum (\w+)/g;
    let match;
    while ((match = pattern.exec(rust.combined)) !== null) {
      const [, attributes, name] = match;
      // Either the whole enum is SCREAMING_SNAKE_CASE, or every variant names
      // its own wire value explicitly (mixed-case Kotlin names like
      // DocumentRAG cannot be produced by rename_all).
      const explicitlyRenamed =
        (bodyOf(rust.combined, name).match(/#\[serde\(rename = "/g) || []).length >=
        (bodyOf(rust.combined, name).match(/^\s{4}[A-Z][A-Za-z0-9_]*,?$/gm) || []).length;
      if (!attributes.includes('rename_all = "SCREAMING_SNAKE_CASE"') && !explicitlyRenamed) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('ID fields are strings on the Rust side, never integers', () => {
    const rust = readRustDomain();
    const structs = parseRustStructs(rust.combined);
    const offenders = [];
    for (const [structName, fields] of Object.entries(structs)) {
      for (const field of fields) {
        if (!/(^id$|Id$)/.test(field.name) || field.name === 'quickActionId') continue;
        // github_ids are numeric in the API but we keep them as strings on the
        // wire (see GitHubRepository.id) so JS precision cannot truncate them.
        if (!/^(String|Option<String>)$/.test(field.type)) {
          offenders.push(`${structName}.${field.rustName}: ${field.type}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('timestamp fields are signed 64-bit integers in milliseconds', () => {
    const rust = readRustDomain();
    const structs = parseRustStructs(rust.combined);
    const offenders = [];
    for (const [structName, fields] of Object.entries(structs)) {
      for (const field of fields) {
        const isTime = /(timestamp|At|Ms)$/.test(field.name) && !/Status$/.test(field.name);
        if (!isTime) continue;
        const baseType = field.type.replace(/^Option<(.+)>$/, '$1');
        if (baseType !== 'i64' && baseType !== 'Timestamp') {
          offenders.push(`${structName}.${field.rustName}: ${field.type}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** Body of an enum/struct declaration, for checks that need to look inside. */
function bodyOf(source, name) {
  const match = source.match(new RegExp(`pub (?:enum|struct) ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match ? match[1] : '';
}

function extractTsDeclaration(source, name) {
  const pattern = new RegExp(`export (?:interface|type) ${name}\\b[\\s\\S]*?\\n\\}`, 'm');
  const match = source.match(pattern);
  return match ? match[0] : null;
}
