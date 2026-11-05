-- Migration 0004: provider secret metadata.
--
-- The database never stores the secret itself. It stores, per provider, the
-- name of the OS keystore entry that holds it plus non-secret bookkeeping the
-- settings screen needs (which providers are configured, when a key was last
-- set). Before this migration the Kotlin app kept API keys in plaintext
-- SharedPreferences; the Kotlin migration path moves them to the Keystore and
-- records only a reference here.

CREATE TABLE IF NOT EXISTS `provider_secrets` (
  `provider` TEXT NOT NULL,             -- GEMINI | OPENAI | ANTHROPIC | ...
  `vaultKey` TEXT NOT NULL,             -- keystore entry name, never the secret
  `isConfigured` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` INTEGER NOT NULL,
  PRIMARY KEY(`provider`)
);
