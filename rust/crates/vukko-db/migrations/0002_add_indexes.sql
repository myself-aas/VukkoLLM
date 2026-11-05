-- Migration 0001 → 0002: legacy data repair.
--
-- Runs against a database that already has the legacy Room tables (either a
-- real shipped install or a fresh install where migration 0002 created them).
-- Forward-only, transactional, and deliberately non-destructive: every statement
-- is idempotent so a crash between statements can be replayed.
--
-- What this migration does:
--   1. normalises enum columns the way the Kotlin domain layer did on read
--      (`MessageSender.valueOf` fallback ASSISTANT, `QueryMode.valueOf` fallback
--      CHAT) so Rust never has to guess;
--   2. repairs the two denormalised counters the Kotlin app kept in sync by hand
--      (thread.messageCount, workspace.documentCount/vectorCount), which are
--      what the workspace drawer and storage inspector display;
--   3. clears the transient `isStreaming` flag: a row still marked streaming is
--      the residue of an interrupted generation from a previous process, and no
--      stream can be live at migration time.

-- 1. Enum normalisation -------------------------------------------------------
UPDATE `chat_messages`
SET `sender` = 'ASSISTANT'
WHERE `sender` NOT IN ('USER', 'ASSISTANT', 'SYSTEM');

UPDATE `workspaces`
SET `queryMode` = 'CHAT'
WHERE `queryMode` NOT IN ('CHAT', 'QUERY', 'AGENT');

UPDATE `workspace_documents`
SET `type` = 'TEXT'
WHERE `type` NOT IN ('TEXT', 'PDF', 'WEB_LINK', 'MARKDOWN');

UPDATE `chat_messages`
SET `agentStepsJson` = '[]'
WHERE `agentStepsJson` IS NULL OR trim(`agentStepsJson`) = '';

UPDATE `chat_messages`
SET `citationsJson` = '[]'
WHERE `citationsJson` IS NULL OR trim(`citationsJson`) = '';

UPDATE `chat_messages`
SET `attachmentsJson` = '[]'
WHERE `attachmentsJson` IS NULL OR trim(`attachmentsJson`) = '';

UPDATE `chat_messages`
SET `toolsUsedJson` = '[]'
WHERE `toolsUsedJson` IS NULL OR trim(`toolsUsedJson`) = '';

UPDATE `chat_messages`
SET `tagsJson` = '[]'
WHERE `tagsJson` IS NULL OR trim(`tagsJson`) = '';

-- 2. Counter repair -----------------------------------------------------------
UPDATE `chat_threads`
SET `messageCount` = (
  SELECT COUNT(*) FROM `chat_messages` WHERE `chat_messages`.`threadId` = `chat_threads`.`id`
);

UPDATE `workspaces`
SET `documentCount` = (
  SELECT COUNT(*) FROM `workspace_documents` WHERE `workspace_documents`.`workspaceId` = `workspaces`.`id`
);

UPDATE `workspaces`
SET `vectorCount` = COALESCE((
  SELECT SUM(`vectorCount`) FROM `workspace_documents` WHERE `workspace_documents`.`workspaceId` = `workspaces`.`id`
), 0);

-- 3. Transient flags ---------------------------------------------------------
UPDATE `chat_messages`
SET `isStreaming` = 0
WHERE `isStreaming` <> 0;

-- Indexes and constraints layered on top of the legacy schema.
--
-- SQLite cannot add a CHECK constraint to an existing table, so the sender
-- domain is enforced with triggers rather than a table rebuild: rebuilding a
-- large chat_messages table at startup is a multi-second stall and a failed
-- rebuild would destroy the only copy of the user's data.

-- Composite index for the hottest read in the chat screen: one thread's
-- messages ordered by time.
CREATE INDEX IF NOT EXISTS `index_chat_messages_thread_timestamp`
  ON `chat_messages` (`threadId`, `timestamp`);

-- Pinned-message and favourite-message filters used by the drawer.
CREATE INDEX IF NOT EXISTS `index_chat_messages_isPinned`
  ON `chat_messages` (`isPinned`);

-- Sender domain enforcement (USER / ASSISTANT / SYSTEM).
CREATE TRIGGER IF NOT EXISTS `chat_messages_sender_insert`
BEFORE INSERT ON `chat_messages`
FOR EACH ROW
WHEN NEW.sender NOT IN ('USER', 'ASSISTANT', 'SYSTEM')
BEGIN
  SELECT RAISE(ABORT, 'chat_messages.sender must be USER, ASSISTANT or SYSTEM');
END;

CREATE TRIGGER IF NOT EXISTS `chat_messages_sender_update`
BEFORE UPDATE OF sender ON `chat_messages`
FOR EACH ROW
WHEN NEW.sender NOT IN ('USER', 'ASSISTANT', 'SYSTEM')
BEGIN
  SELECT RAISE(ABORT, 'chat_messages.sender must be USER, ASSISTANT or SYSTEM');
END;
