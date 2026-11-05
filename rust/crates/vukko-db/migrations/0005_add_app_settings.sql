-- Migration 0005: application settings.
--
-- Preferences the Kotlin app kept in SharedPreferences (`vukko_prefs`) and that
-- the app needs transactional with the rest of the user's data: the active
-- workspace/thread, the selected provider and model, tool toggles and backup
-- scheduling. Secret material is NOT stored here — see provider_secrets.
--
-- Keys keep the Kotlin preference names (`active_workspace_id`,
-- `selected_provider`, …) so an upgrade can copy them verbatim and so a downgrade
-- still finds values it understands.

CREATE TABLE IF NOT EXISTS `app_settings` (
  `key` TEXT NOT NULL,
  `value` TEXT NOT NULL,
  `updatedAt` INTEGER NOT NULL,
  PRIMARY KEY(`key`)
);
