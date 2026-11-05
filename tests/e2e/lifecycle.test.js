/**
 * Phase 9, Step 12.5: the minimum end-to-end scenario, executed.
 *
 * The plan lists twelve steps from a fresh install to a legacy upgrade. Every
 * step that does not need a device runs here, over the same engine and bridge
 * contract the app uses:
 *
 *   1 install (fresh database)      7 restart (reopen the same file)
 *   2 onboarding (settings chosen)  8 export the thread
 *   3 workspace + thread            9 integrity check
 *   4 send with a mock provider    10 trigger backup
 *   5 streamed content             11 upgrade from a legacy Kotlin database
 *   6 (continues in 7)             12 confirm the data is still readable
 *
 * A failure here means the assembled product does not work, even if every unit
 * test passes — which is exactly what this suite exists to catch.
 */

const { mkdtempSync, rmSync, existsSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { createEngine } = require('../support/engine.cjs');
const { adoptDatabase } = require('../migration/support/adopt.cjs');
const { buildFixture } = require('../migration/fixtures/buildLegacyDb.cjs');

const { ChatService } = require('../../src/services/chatService');
const { parseStream, buildRequest } = require('../../src/services/providers');
const fixtures = require('../providers/fixtures');

let directory;
let databasePath;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'vukko-e2e-'));
  databasePath = join(directory, 'vukko.db');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/**
 * A bridge port over the engine, exactly as the app wires it: each call maps to
 * the repository operation the Rust bridge exposes for it.
 */
function createPort(engine) {
  // The placeholder id the service is streaming into, so completion and failure
  // land on the same row the deltas were written to.
  let streamingId = null;

  return {
    createUserTurn: (threadId, content) =>
      engine.messages.append({ threadId, sender: 'USER', content }),
    async createAssistantPlaceholder(threadId) {
      const message = await engine.messages.append({
        threadId,
        sender: 'ASSISTANT',
        content: '',
        isStreaming: true,
      });
      streamingId = message.id;
      return message;
    },
    appendDelta: (_requestId, messageId, delta) => engine.messages.appendDelta(messageId, delta),
    complete: (_requestId, content) => engine.messages.complete(streamingId, content),
    fail: (_requestId, error) => engine.messages.fail(streamingId, error.message),
    cancel: () => engine.messages.fail(streamingId, 'cancelled'),
  };
}

describe('the minimum end-to-end scenario', () => {
  test('fresh install through legacy upgrade keeps every message', async () => {
    // 1. Install: a fresh database is created and owned by Rust.
    const engine = createEngine(databasePath);
    await engine.initialize();

    // 2. Onboarding: the chosen model survives a restart.
    await engine.settings.set('selectedProvider', 'GEMINI');
    await engine.settings.set('selectedModelId', 'gemini-2.5-flash');

    // 3. A workspace and a thread.
    const workspace = await engine.workspaces.create({ name: 'Personal' });
    const thread = await engine.threads.create({ workspaceId: workspace.id, name: 'Sovereignty' });

    // 4–5. Send with a mock provider and receive streamed content.
    const events = [];
    const service = new ChatService(createPort(engine), (event) => events.push(event));
    const request = await service.send({
      threadId: thread.id,
      content: 'What is sovereignty?',
      provider: 'INSTANCE',
      modelId: 'vukko-workspace-default',
      systemPrompt: 'Be brief.',
      attachments: [],
    });

    // The recorded frame sequence, serialised exactly as the wire delivers it.
    const body = fixtures.instanceNdjson.map((frame) => JSON.stringify(frame)).join('\n');
    const stream = parseStream('INSTANCE', body);
    await service.handleProviderStream(request.requestId, stream);

    expect(events.some((event) => event.type === 'message.delta')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'message.completed' });

    const before = await engine.messages.list(thread.id);
    expect(before).toHaveLength(2);
    expect(before[1].content.length).toBeGreaterThan(0);
    const answer = before[1].content;
    engine.close();

    // 6–7. Restart: a new engine over the same file sees the same transcript.
    const restarted = createEngine(databasePath);
    await restarted.initialize();
    expect(await restarted.settings.getAll()).toMatchObject({
      selectedModelId: 'gemini-2.5-flash',
    });
    const after = await restarted.messages.list(thread.id);
    expect(after.map((message) => message.content)).toEqual(before.map((m) => m.content));

    // 8. Export the thread.
    const exported = await restarted.exports.thread(thread.id, 'md');
    expect(exported.content).toContain('What is sovereignty?');
    expect(exported.content).toContain(answer);

    // 9. Integrity check on the live database.
    const integrity = await restarted.storage.runIntegrityCheck();
    expect(integrity.ok).toBe(true);

    // 10. A backup archive is produced and checksummed.
    const archive = await restarted.backups.archive(1_700_000_000_000);
    expect(archive.workspaceCount).toBe(1);
    expect(archive.fileName).toBe('vukko_backup_20231114_221320.json');
    expect(archive.checksum).toMatch(/^[0-9a-f]{64}$/);

    restarted.close();

    // 11. An existing Kotlin installation is upgraded, not replaced.
    const legacyPath = join(directory, 'legacy.db');
    // A realistic pre-migration install: several workspaces, threads and messages.
    buildFixture('rich', legacyPath);
    const legacyCounts = countLegacy(legacyPath);

    const adoption = adoptDatabase(legacyPath);
    expect(adoption.status).toBe('COMPLETED');
    expect(adoption.migratedFromLegacy).toBe(true);

    // 12. Every legacy record is still readable through the repositories.
    const upgraded = createEngine(legacyPath);
    await upgraded.initialize();
    const counts = await upgraded.counts();
    expect(counts.workspaces).toBe(legacyCounts.workspaces);
    expect(counts.threads).toBe(legacyCounts.threads);
    expect(counts.messages).toBe(legacyCounts.messages);
    expect((await upgraded.storage.runIntegrityCheck()).ok).toBe(true);

    const legacyWorkspaces = await upgraded.workspaces.list();
    let readableMessages = 0;
    for (const legacyWorkspace of legacyWorkspaces) {
      for (const legacyThread of await upgraded.threads.list(legacyWorkspace.id)) {
        const rows = await upgraded.messages.list(legacyThread.id);
        expect(rows.every((message) => typeof message.content === 'string')).toBe(true);
        readableMessages += rows.length;
      }
    }
    // Every message the Kotlin app wrote is readable through the repositories,
    // not merely present in the file.
    expect(readableMessages).toBe(legacyCounts.messages);
    expect(readableMessages).toBeGreaterThan(0);
    upgraded.close();
  });

  test('the provider request built for the instance server is what the mock recorded', () => {
    const prepared = buildRequest(
      'INSTANCE',
      {
        model: 'vukko-workspace-default',
        systemPrompt: 'Be brief.',
        messages: [{ role: 'USER', content: 'What is sovereignty?' }],
        temperature: 0.7,
        maxTokens: 1024,
        attachments: [],
      },
      { baseUrl: 'http://10.0.2.2:3001' },
    );

    expect(prepared.url).toBe('http://10.0.2.2:3001/v1/chat');
    expect(prepared.body.systemPrompt).toBe('Be brief.');
  });

  test('a second install does not re-run the migration', async () => {
    const engine = createEngine(databasePath);
    await engine.initialize();
    engine.close();

    // A clean database is not a legacy one, so nothing is "migrated" again.
    const second = adoptDatabase(databasePath);
    expect(second.migratedFromLegacy).toBe(false);
    expect(second.backupPath).toBeNull();
  });
});

function countLegacy(path) {
  const db = new DatabaseSync(path);
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM \`${table}\``).get().n;
  const counts = {
    workspaces: count('workspaces'),
    threads: count('chat_threads'),
    messages: count('chat_messages'),
  };
  db.close();
  return counts;
}
