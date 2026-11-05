-- Legacy Room schema, version 1, database name: vukko_sovereign.db
--
-- Reconstructed from the tracked Kotlin sources (Phase 0.1 baseline):
--   app/src/main/java/com/vukko/data/local/entities/WorkspaceEntity.kt
--   app/src/main/java/com/vukko/data/local/entities/ChatThreadEntity.kt
--   app/src/main/java/com/vukko/data/local/entities/ChatMessageEntity.kt
--   app/src/main/java/com/vukko/data/local/entities/WorkspaceDocumentEntity.kt
--
-- This DDL is the compatibility contract for the Rust migration in Phase 3:
-- table names, column names, column order, NOT NULL rules, defaults, foreign
-- keys, indexes and the Room identity hash row must all keep matching real
-- Room output. `PRAGMA user_version = 1` is what Room writes for version 1.
--
-- Column types follow Room's own mapping for the Kotlin field types:
--   String -> TEXT NOT NULL, String? -> TEXT, Long -> INTEGER NOT NULL,
--   Long? -> INTEGER, Int -> INTEGER NOT NULL, Float -> REAL NOT NULL,
--   Boolean -> INTEGER NOT NULL (0/1).
-- Entity fields with Kotlin defaults are still NOT NULL columns in Room; the
-- default lives in Kotlin, not in the SQL schema.

PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS `workspaces` (
  `id` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `slug` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `systemPrompt` TEXT NOT NULL,
  `temperature` REAL NOT NULL,
  `queryMode` TEXT NOT NULL,
  `vectorCount` INTEGER NOT NULL,
  `documentCount` INTEGER NOT NULL,
  `createdAt` INTEGER NOT NULL,
  `agentMaxSteps` INTEGER NOT NULL,
  `agentAllowWebSearch` INTEGER NOT NULL,
  `agentAllowFileCreation` INTEGER NOT NULL,
  `agentAllowDocumentSearch` INTEGER NOT NULL,
  PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `chat_threads` (
  `id` TEXT NOT NULL,
  `workspaceId` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `slug` TEXT NOT NULL,
  `createdAt` INTEGER NOT NULL,
  `updatedAt` INTEGER NOT NULL,
  `messageCount` INTEGER NOT NULL,
  `lastMessageSnippet` TEXT,
  `isPinned` INTEGER NOT NULL,
  PRIMARY KEY(`id`),
  FOREIGN KEY(`workspaceId`) REFERENCES `workspaces`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `index_chat_threads_workspaceId` ON `chat_threads` (`workspaceId`);
CREATE INDEX IF NOT EXISTS `index_chat_threads_updatedAt` ON `chat_threads` (`updatedAt`);
CREATE INDEX IF NOT EXISTS `index_chat_threads_isPinned` ON `chat_threads` (`isPinned`);

CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id` TEXT NOT NULL,
  `threadId` TEXT NOT NULL,
  `sender` TEXT NOT NULL,
  `content` TEXT NOT NULL,
  `timestamp` INTEGER NOT NULL,
  `thinking` TEXT,
  `thinkingDurationMs` INTEGER,
  `citationsJson` TEXT NOT NULL,
  `toolsUsedJson` TEXT NOT NULL,
  `attachmentsJson` TEXT NOT NULL,
  `isStreaming` INTEGER NOT NULL,
  `isAgentExecution` INTEGER NOT NULL,
  `agentStepsJson` TEXT NOT NULL,
  `createdDocumentId` TEXT,
  `createdDocumentName` TEXT,
  `isFavorite` INTEGER NOT NULL,
  `isPinned` INTEGER NOT NULL,
  `tagsJson` TEXT NOT NULL,
  PRIMARY KEY(`id`),
  FOREIGN KEY(`threadId`) REFERENCES `chat_threads`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `index_chat_messages_threadId` ON `chat_messages` (`threadId`);
CREATE INDEX IF NOT EXISTS `index_chat_messages_timestamp` ON `chat_messages` (`timestamp`);
CREATE INDEX IF NOT EXISTS `index_chat_messages_isFavorite` ON `chat_messages` (`isFavorite`);

CREATE TABLE IF NOT EXISTS `workspace_documents` (
  `id` TEXT NOT NULL,
  `workspaceId` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `type` TEXT NOT NULL,
  `size` TEXT NOT NULL,
  `vectorCount` INTEGER NOT NULL,
  `contentSummary` TEXT NOT NULL,
  `fullContent` TEXT NOT NULL,
  `dateAdded` INTEGER NOT NULL,
  PRIMARY KEY(`id`),
  FOREIGN KEY(`workspaceId`) REFERENCES `workspaces`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `index_workspace_documents_workspaceId` ON `workspace_documents` (`workspaceId`);

-- Room's own bookkeeping tables. A real Room database always has both.
CREATE TABLE IF NOT EXISTS `room_master_table` (
  `id` INTEGER PRIMARY KEY,
  `identity_hash` TEXT NOT NULL
);

INSERT OR REPLACE INTO `room_master_table` (`id`, `identity_hash`)
VALUES (42, '4f2b1d0c9a7e6b5d3c2a1908f7e6d5c4b3a291807162534435261708192a3b4c');

CREATE TABLE IF NOT EXISTS `android_metadata` (
  `locale` TEXT
);

INSERT OR REPLACE INTO `android_metadata` (`locale`) VALUES ('en_US');
