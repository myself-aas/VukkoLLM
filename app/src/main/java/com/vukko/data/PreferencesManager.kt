package com.vukko.data

import android.content.Context
import android.content.SharedPreferences
import com.vukko.model.ProviderType

/**
 * Non-secret user settings.
 *
 * Credentials (provider API keys, the instance key, GitHub tokens, device
 * codes and SSH keys) deliberately do NOT live here any more: SharedPreferences
 * is plaintext on disk and included in `allowBackup` transfers. They are read
 * and written through [SecurePreferencesManager], which keeps them encrypted
 * with an Android Keystore key. The accessors below are kept so existing
 * callers keep compiling and so an encrypted value is migrated out of the old
 * plaintext slot on first read.
 */
class PreferencesManager(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("vukko_prefs", Context.MODE_PRIVATE)
    private val secure = SecurePreferencesManager(context.applicationContext)

    /**
     * Reads a secret from secure storage. A value still sitting in the old
     * plaintext slot (installs upgrading from a pre-1.1 build) is moved into
     * encrypted storage and deleted from the plaintext file.
     */
    private fun readSecret(name: String): String {
        val legacy = prefs.getString(name, null)
        if (legacy.isNullOrEmpty()) return secure.getSecret(name)
        secure.setSecret(name, legacy)
        prefs.edit().remove(name).apply()
        return legacy
    }

    private fun writeSecret(name: String, value: String) {
        secure.setSecret(name, value)
        prefs.edit().remove(name).apply()
    }

    var activeWorkspaceId: String
        get() = prefs.getString("active_workspace_id", "ws_default") ?: "ws_default"
        set(value) = prefs.edit().putString("active_workspace_id", value).apply()

    var activeThreadId: String
        get() = prefs.getString("active_thread_id", "th_default") ?: "th_default"
        set(value) = prefs.edit().putString("active_thread_id", value).apply()

    var selectedProvider: ProviderType
        get() {
            val name = prefs.getString("selected_provider", ProviderType.GEMINI.name) ?: ProviderType.GEMINI.name
            return try { ProviderType.valueOf(name) } catch (e: Exception) { ProviderType.GEMINI }
        }
        set(value) = prefs.edit().putString("selected_provider", value.name).apply()

    var selectedModelId: String
        get() = prefs.getString("selected_model_id", "gemini-2.5-flash") ?: "gemini-2.5-flash"
        set(value) = prefs.edit().putString("selected_model_id", value).apply()

    fun getApiKey(provider: ProviderType): String {
        return readSecret(SecurePreferencesManager.apiKeyName(provider))
    }

    fun setApiKey(provider: ProviderType, key: String) {
        writeSecret(SecurePreferencesManager.apiKeyName(provider), key)
    }

    var instanceUrl: String
        get() = prefs.getString("instance_url", "http://10.0.2.2:3001") ?: "http://10.0.2.2:3001"
        set(value) = prefs.edit().putString("instance_url", value).apply()

    var instanceApiKey: String
        get() = readSecret(SecurePreferencesManager.INSTANCE_API_KEY)
        set(value) = writeSecret(SecurePreferencesManager.INSTANCE_API_KEY, value)

    var webSearchEnabled: Boolean
        get() = prefs.getBoolean("tool_web_search", true)
        set(value) = prefs.edit().putBoolean("tool_web_search", value).apply()

    var autoApproveTools: Boolean
        get() = prefs.getBoolean("tool_auto_approve", true)
        set(value) = prefs.edit().putBoolean("tool_auto_approve", value).apply()

    var githubToken: String
        get() = readSecret(SecurePreferencesManager.GITHUB_TOKEN)
        set(value) = writeSecret(SecurePreferencesManager.GITHUB_TOKEN, value)

    var githubUsername: String
        get() = prefs.getString("github_username", "") ?: ""
        set(value) = prefs.edit().putString("github_username", value).apply()

    var githubAvatarUrl: String
        get() = prefs.getString("github_avatar_url", "") ?: ""
        set(value) = prefs.edit().putString("github_avatar_url", value).apply()

    var githubTokenType: String
        get() = prefs.getString("github_token_type", "bearer") ?: "bearer"
        set(value) = prefs.edit().putString("github_token_type", value).apply()

    var githubOAuthConnected: Boolean
        get() = prefs.getBoolean("github_oauth_connected", false)
        set(value) = prefs.edit().putBoolean("github_oauth_connected", value).apply()

    var githubDeviceCode: String
        get() = readSecret(SecurePreferencesManager.GITHUB_DEVICE_CODE)
        set(value) = writeSecret(SecurePreferencesManager.GITHUB_DEVICE_CODE, value)

    var githubUserCode: String
        get() = readSecret(SecurePreferencesManager.GITHUB_USER_CODE)
        set(value) = writeSecret(SecurePreferencesManager.GITHUB_USER_CODE, value)

    var githubSshKey: String
        get() = readSecret(SecurePreferencesManager.GITHUB_SSH_KEY)
        set(value) = writeSecret(SecurePreferencesManager.GITHUB_SSH_KEY, value)

    var githubAuthMode: String
        get() = prefs.getString("github_auth_mode", "oauth") ?: "oauth"
        set(value) = prefs.edit().putString("github_auth_mode", value).apply()

    var biometricLockEnabled: Boolean
        get() = prefs.getBoolean("biometric_lock_enabled", false)
        set(value) = prefs.edit().putBoolean("biometric_lock_enabled", value).apply()

    var backupEnabled: Boolean
        get() = prefs.getBoolean("backup_enabled", false)
        set(value) = prefs.edit().putBoolean("backup_enabled", value).apply()

    var backupFrequencyHours: Int
        get() = prefs.getInt("backup_frequency", 24)
        set(value) = prefs.edit().putInt("backup_frequency", value).apply()

    var backupTarget: String
        get() = prefs.getString("backup_target", "github") ?: "github"
    set(value) = prefs.edit().putString("backup_target", value).apply()

    var backupGitHubRepo: String
        get() = prefs.getString("backup_github_repo", "") ?: ""
    set(value) = prefs.edit().putString("backup_github_repo", value).apply()

    var backupCloudBucket: String
        get() = prefs.getString("backup_cloud_bucket", "") ?: ""
    set(value) = prefs.edit().putString("backup_cloud_bucket", value).apply()

    var lastBackupTimestamp: Long
        get() = prefs.getLong("last_backup_timestamp", 0L)
        set(value) = prefs.edit().putLong("last_backup_timestamp", value).apply()
}
