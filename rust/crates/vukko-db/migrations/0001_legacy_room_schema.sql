-- Migration 0001: legacy Room v1 schema.
--
-- This is the DDL Room generated for `vukko_sovereign.db` version 1, reproduced
-- exactly (table and column names, order, NOT NULL rules, defaults, foreign
-- keys, indexes). It serves two purposes:
--
--   * fresh install: the Rust engine creates this schema, so a new install and
--     an upgraded install have byte-identical tables;
--   * legacy install: every statement is `IF NOT EXISTS`, so applying it to a
--     database the Kotlin app already created is a no-op.
--
-- Column types follow Room's mapping (String -> TEXT NOT NULL, String? -> TEXT,
-- Long -> INTEGER, Float -> REAL, Boolean -> INTEGER 0/1, enums -> TEXT).
-- The compatibility contract version of this file is asserted by
-- tests/migration/fixtures/baseline.test.js and tests/migration/adoption.test.js.

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
