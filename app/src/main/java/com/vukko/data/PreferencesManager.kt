package com.vukko.data

import android.content.Context
import android.content.SharedPreferences
import com.vukko.model.ProviderType

class PreferencesManager(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("vukko_prefs", Context.MODE_PRIVATE)

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
        return prefs.getString("api_key_${provider.name}", "") ?: ""
    }

    fun setApiKey(provider: ProviderType, key: String) {
        prefs.edit().putString("api_key_${provider.name}", key).apply()
    }

    var instanceUrl: String
        get() = prefs.getString("instance_url", "http://10.0.2.2:3001") ?: "http://10.0.2.2:3001"
        set(value) = prefs.edit().putString("instance_url", value).apply()

    var instanceApiKey: String
        get() = prefs.getString("instance_api_key", "") ?: ""
        set(value) = prefs.edit().putString("instance_api_key", value).apply()

    var webSearchEnabled: Boolean
        get() = prefs.getBoolean("tool_web_search", true)
        set(value) = prefs.edit().putBoolean("tool_web_search", value).apply()

    var autoApproveTools: Boolean
        get() = prefs.getBoolean("tool_auto_approve", true)
        set(value) = prefs.edit().putBoolean("tool_auto_approve", value).apply()

    var githubToken: String
        get() = prefs.getString("github_token", "") ?: ""
        set(value) = prefs.edit().putString("github_token", value).apply()

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
        get() = prefs.getString("github_device_code", "") ?: ""
        set(value) = prefs.edit().putString("github_device_code", value).apply()

    var githubUserCode: String
        get() = prefs.getString("github_user_code", "") ?: ""
        set(value) = prefs.edit().putString("github_user_code", value).apply()

    var githubSshKey: String
        get() = prefs.getString("github_ssh_key", "") ?: ""
        set(value) = prefs.edit().putString("github_ssh_key", value).apply()

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
