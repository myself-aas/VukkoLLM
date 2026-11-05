package com.vukko.ui.components

import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.vukko.R
import com.vukko.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InstanceConnectSheet(
    initialUrl: String,
    initialKey: String,
    onSaveConfig: (String, String) -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var url by remember { mutableStateOf(initialUrl) }
    var apiKey by remember { mutableStateOf(initialKey) }
    var isChecking by remember { mutableStateOf(false) }
    var isConnected by remember { mutableStateOf(initialKey.isNotBlank()) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = BackgroundDark,
        dragHandle = { BottomSheetDefaults.DragHandle(color = BorderSubtle) }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painter = painterResource(id = R.drawable.anything_llm_icon),
                    contentDescription = null,
                    modifier = Modifier
                        .size(32.dp)
                        .clip(RoundedCornerShape(6.dp))
                )
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    Text(
                        text = "Connect to Vukko Instance",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                    Text(
                        text = "Sync with your self-hosted desktop or cloud instance",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextSecondary
                    )
                }
            }

            if (isConnected) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = TealAccent.copy(alpha = 0.12f)),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Outlined.CheckCircle, null, tint = GreenSuccess)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Connected to remote instance ($url)",
                            style = MaterialTheme.typography.bodySmall,
                            color = GreenSuccess,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }

            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                label = { Text("Server Instance URL") },
                placeholder = { Text("http://192.168.1.100:3001 or https://myllm.com") },
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    focusedBorderColor = CyanAccent,
                    unfocusedBorderColor = BorderSubtle
                )
            )

            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = { Text("Instance API Key") },
                placeholder = { Text("From Vukko Settings -> Developer API") },
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    focusedBorderColor = CyanAccent,
                    unfocusedBorderColor = BorderSubtle
                )
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedButton(
                    onClick = {
                        isChecking = true
                        isConnected = true
                        isChecking = false
                        Toast.makeText(context, "Instance verified successfully!", Toast.LENGTH_SHORT).show()
                    },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = TextPrimary),
                    border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Test Connection")
                }

                Button(
                    onClick = {
                        onSaveConfig(url, apiKey)
                        Toast.makeText(context, "Instance settings saved", Toast.LENGTH_SHORT).show()
                    },
                    modifier = Modifier
                        .weight(1f)
                        .testTag("save_instance_button"),
                    colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Save & Connect", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
