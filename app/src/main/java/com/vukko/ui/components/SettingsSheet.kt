package com.vukko.ui.components

import android.widget.Toast
import androidx.fragment.app.FragmentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vukko.data.PreferencesManager
import com.vukko.model.ProviderType
import com.vukko.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(
    preferencesManager: PreferencesManager,
    onRescheduleBackup: () -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var webSearchEnabled by remember { mutableStateOf(preferencesManager.webSearchEnabled) }
    var autoApproveTools by remember { mutableStateOf(preferencesManager.autoApproveTools) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = BackgroundDark,
        dragHandle = { BottomSheetDefaults.DragHandle(color = BorderSubtle) }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp)
        ) {
            Text(
                text = "Settings & Preferences",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            )
            Text(
                text = "Manage LLM API credentials, agent tools, and instance sync",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                modifier = Modifier.padding(bottom = 16.dp)
            )

            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 460.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // Section: Security & Biometric Lock
                item {
                    Text(
                        text = "SECURITY & BIOMETRIC AUTH",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMuted,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                }

                item {
                    var biometricEnabled by remember { mutableStateOf(preferencesManager.biometricLockEnabled) }
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfaceCard),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("Biometric App Lock", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                                    Text("Require fingerprint or face unlock to access Vukko", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                                }
                                Switch(
                                    checked = biometricEnabled,
                                    onCheckedChange = { enabled ->
                                        if (enabled) {
                                            val activity = context as? FragmentActivity
                                            if (activity != null) {
                                                BiometricAuthHelper.authenticate(
                                                    activity = activity,
                                                    title = "Enable Biometric Lock",
                                                    subtitle = "Authenticate to confirm biometric security lock",
                                                    onSuccess = {
                                                        biometricEnabled = true
                                                        preferencesManager.biometricLockEnabled = true
                                                        Toast.makeText(context, "Biometric Lock Enabled", Toast.LENGTH_SHORT).show()
                                                    },
                                                    onError = { err ->
                                                        Toast.makeText(context, "Failed: $err", Toast.LENGTH_SHORT).show()
                                                    }
                                                )
                                            } else {
                                                biometricEnabled = true
                                                preferencesManager.biometricLockEnabled = true
                                            }
                                        } else {
                                            biometricEnabled = false
                                            preferencesManager.biometricLockEnabled = false
                                            Toast.makeText(context, "Biometric Lock Disabled", Toast.LENGTH_SHORT).show()
                                        }
                                    },
                                    colors = SwitchDefaults.colors(checkedThumbColor = BackgroundDark, checkedTrackColor = CyanAccent)
                                )
                            }
                        }
                    }
                }

                // Section: Cloud Backup & Data Redundancy
                item {
                    Text(
                        text = "CLOUD BACKUP & DATA REDUNDANCY",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMuted,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                }

                item {
                    var backupEnabled by remember { mutableStateOf(preferencesManager.backupEnabled) }
                    var backupTarget by remember { mutableStateOf(preferencesManager.backupTarget) }
                    var githubRepo by remember { mutableStateOf(preferencesManager.backupGitHubRepo) }
                    var cloudBucket by remember { mutableStateOf(preferencesManager.backupCloudBucket) }
                    var frequency by remember { mutableStateOf(preferencesManager.backupFrequencyHours) }

                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfaceCard),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("Automated Background Backup", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                                    Text("Periodically sync local DB to external storage", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                                }
                                Switch(
                                    checked = backupEnabled,
                                    onCheckedChange = { 
                                        backupEnabled = it
                                        preferencesManager.backupEnabled = it
                                        onRescheduleBackup()
                                    },
                                    colors = SwitchDefaults.colors(checkedThumbColor = BackgroundDark, checkedTrackColor = CyanAccent)
                                )
                            }

                            if (backupEnabled) {
                                HorizontalDivider(color = BorderSubtle)
                                
                                Text("Backup Target", style = MaterialTheme.typography.labelSmall, color = TextMuted)
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    FilterChip(
                                        selected = backupTarget == "github",
                                        onClick = { 
                                            backupTarget = "github"
                                            preferencesManager.backupTarget = "github"
                                        },
                                        label = { Text("GitHub") },
                                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = CyanAccent.copy(alpha = 0.2f), selectedLabelColor = CyanAccent)
                                    )
                                    FilterChip(
                                        selected = backupTarget == "cloud_bucket",
                                        onClick = { 
                                            backupTarget = "cloud_bucket"
                                            preferencesManager.backupTarget = "cloud_bucket"
                                        },
                                        label = { Text("Cloud Bucket") },
                                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = CyanAccent.copy(alpha = 0.2f), selectedLabelColor = CyanAccent)
                                    )
                                }

                                if (backupTarget == "github") {
                                    OutlinedTextField(
                                        value = githubRepo,
                                        onValueChange = { 
                                            githubRepo = it
                                            preferencesManager.backupGitHubRepo = it
                                        },
                                        label = { Text("GitHub Repository (owner/repo)") },
                                        placeholder = { Text("e.g. shuvo/vukko-backups") },
                                        singleLine = true,
                                        modifier = Modifier.fillMaxWidth(),
                                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle)
                                    )
                                } else {
                                    OutlinedTextField(
                                        value = cloudBucket,
                                        onValueChange = { 
                                            cloudBucket = it
                                            preferencesManager.backupCloudBucket = it
                                        },
                                        label = { Text("Cloud Storage Bucket Name") },
                                        placeholder = { Text("e.g. vukko-sovereign-vault") },
                                        singleLine = true,
                                        modifier = Modifier.fillMaxWidth(),
                                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle)
                                    )
                                }

                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Sync Every", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                                    Spacer(modifier = Modifier.width(8.dp))
                                    listOf(6, 12, 24, 48).forEach { hrs ->
                                        SuggestionChip(
                                            onClick = { 
                                                frequency = hrs
                                                preferencesManager.backupFrequencyHours = hrs
                                                onRescheduleBackup()
                                            },
                                            label = { Text("${hrs}h") },
                                            colors = SuggestionChipDefaults.suggestionChipColors(
                                                containerColor = if (frequency == hrs) CyanAccent.copy(alpha = 0.2f) else SurfaceDark,
                                                labelColor = if (frequency == hrs) CyanAccent else TextSecondary
                                            )
                                        )
                                        Spacer(modifier = Modifier.width(4.dp))
                                    }
                                }

                                Button(
                                    onClick = { 
                                        Toast.makeText(context, "Manual Backup Triggered", Toast.LENGTH_SHORT).show()
                                        androidx.work.WorkManager.getInstance(context).enqueue(
                                            androidx.work.OneTimeWorkRequestBuilder<com.vukko.data.sync.BackupWorker>().build()
                                        )
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = ButtonDefaults.buttonColors(containerColor = SurfaceVariantDark, contentColor = CyanAccent),
                                    shape = RoundedCornerShape(8.dp)
                                ) {
                                    Icon(Icons.Outlined.CloudUpload, null, modifier = Modifier.size(18.dp))
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Force Sync Now")
                                }
                                
                                if (preferencesManager.lastBackupTimestamp > 0) {
                                    val date = java.util.Date(preferencesManager.lastBackupTimestamp)
                                    val fmt = java.text.SimpleDateFormat("MMM dd, HH:mm", java.util.Locale.getDefault())
                                    Text(
                                        text = "Last successful sync: ${fmt.format(date)}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = TextMuted,
                                        modifier = Modifier.align(Alignment.CenterHorizontally)
                                    )
                                }
                            }
                        }
                    }
                }

                // Section: Provider API Keys
                item {
                    Text(
                        text = "LLM PROVIDERS & API KEYS",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMuted,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                }

                items(ProviderType.values().filter { it != ProviderType.INSTANCE }) { provider ->
                    var key by remember { mutableStateOf(preferencesManager.getApiKey(provider)) }
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfaceCard),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text(provider.displayName, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                            Spacer(modifier = Modifier.height(6.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                OutlinedTextField(
                                    value = key,
                                    onValueChange = { key = it },
                                    placeholder = { Text(if (provider.isLocal) "http://10.0.2.2:11434" else "API key") },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedTextColor = TextPrimary,
                                        unfocusedTextColor = TextPrimary,
                                        focusedBorderColor = CyanAccent,
                                        unfocusedBorderColor = BorderSubtle
                                    )
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Button(
                                    onClick = {
                                        preferencesManager.setApiKey(provider, key)
                                        Toast.makeText(context, "${provider.displayName} key saved", Toast.LENGTH_SHORT).show()
                                    },
                                    colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark),
                                    shape = RoundedCornerShape(8.dp)
                                ) {
                                    Text("Save", fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }

                // Section: About
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfaceCard),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text("Vukko Android Edition", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = TextPrimary)
                            Text("Native Jetpack Compose Client • v1.3.2", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                            Spacer(modifier = Modifier.height(4.dp))
                            Text("Full privacy isolation, multi-provider model switching, and persistent workspace RAG.", style = MaterialTheme.typography.labelSmall, color = TextMuted)
                        }
                    }
                }
            }
        }
    }
}
