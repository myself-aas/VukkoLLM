package com.vukko.data

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.vukko.model.ProviderType
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keystore-backed store for credential material (API keys, OAuth tokens,
 * device codes, SSH keys).
 *
 * Values are encrypted with an AES-256-GCM key that lives in the Android
 * Keystore and never leaves it, then persisted as Base64 IV+ciphertext in a
 * dedicated preferences file. [PreferencesManager] keeps only non-secret
 * settings; anything secret goes through here so the "API keys and OAuth
 * tokens are never stored in plaintext" invariant holds until the Rust secure
 * storage bridge replaces this class.
 *
 * Ciphertexts are version-tagged ("vukko:v1:") so a later key rotation or a
 * move to the Rust layer can migrate values instead of silently dropping them.
 * A value that cannot be decrypted (keystore reset, app restore to a new
 * device) reads back as the empty string rather than throwing: a user then
 * simply re-enters the key, which is the documented recovery path.
 */
class SecurePreferencesManager(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    fun getSecret(name: String): String {
        val stored = prefs.getString(name, null) ?: return ""
        if (!stored.startsWith(PREFIX)) return ""
        return try {
            val payload = Base64.decode(stored.removePrefix(PREFIX), Base64.NO_WRAP)
            if (payload.size <= GCM_IV_LENGTH) return ""
            val iv = payload.copyOfRange(0, GCM_IV_LENGTH)
            val ciphertext = payload.copyOfRange(GCM_IV_LENGTH, payload.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            val plain = cipher.doFinal(ciphertext)
            String(plain, Charsets.UTF_8)
        } catch (_: Exception) {
            ""
        }
    }

    fun setSecret(name: String, value: String) {
        if (value.isEmpty()) {
            prefs.edit().remove(name).apply()
            return
        }
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            val payload = cipher.iv + ciphertext
            val encoded = PREFIX + Base64.encodeToString(payload, Base64.NO_WRAP)
            // commit() rather than apply(): a credential must be on disk before
            // the caller reports the save as successful.
            prefs.edit().putString(name, encoded).commit()
        } catch (_: Exception) {
            // Never fall back to storing plaintext.
            prefs.edit().remove(name).apply()
        }
    }

    /** Removes every stored secret, for logout and "clear credentials" flows. */
    fun clearAll() {
        prefs.edit().clear().commit()
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "vukko_secret_store_v1"
        private const val PREFS_FILE = "vukko_secure_prefs"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_IV_LENGTH = 12
        private const val GCM_TAG_BITS = 128
        private const val PREFIX = "vukko:v1:"

        fun apiKeyName(provider: ProviderType): String = "api_key_${provider.name}"
        const val INSTANCE_API_KEY = "instance_api_key"
        const val GITHUB_TOKEN = "github_token"
        const val GITHUB_SSH_KEY = "github_ssh_key"
        const val GITHUB_DEVICE_CODE = "github_device_code"
        const val GITHUB_USER_CODE = "github_user_code"
    }
}
