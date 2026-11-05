package com.vukko

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import com.vukko.theme.VukkoTheme
import com.vukko.theme.BackgroundDark
import com.vukko.ui.components.BiometricAuthHelper
import com.vukko.ui.screens.ChatScreen
import com.vukko.viewmodel.MainViewModel

class MainActivity : FragmentActivity() {

    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        
        // Initialize Background Backup Sync
        com.vukko.data.sync.BackupManager(this).scheduleBackup()

        val prefs = viewModel.preferencesManager
        if (prefs.biometricLockEnabled) {
            BiometricAuthHelper.authenticate(
                activity = this,
                title = "Unlock Vukko",
                subtitle = "Authenticate to access your secure chat history",
                onSuccess = {
                    // Authenticated successfully
                },
                onError = { err ->
                    // Handle auth error gracefully
                }
            )
        }

        setContent {
            VukkoTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = BackgroundDark
                ) {
                    ChatScreen(viewModel = viewModel)
                }
            }
        }
    }
}
