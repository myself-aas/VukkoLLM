package com.vukko.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import com.vukko.model.MessageAttachment
import com.vukko.model.QueryMode
import com.vukko.theme.*
import java.util.UUID

@Composable
fun PromptInputBar(
    queryMode: QueryMode,
    isGenerating: Boolean,
    attachments: List<MessageAttachment>,
    onToggleQueryMode: (QueryMode) -> Unit,
    onAddAttachment: (MessageAttachment) -> Unit,
    onRemoveAttachment: (String) -> Unit,
    onSendMessage: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var text by remember { mutableStateOf("") }
    val context = LocalContext.current
    var attachMenuExpanded by remember { mutableStateOf(false) }
    var isListeningVoice by remember { mutableStateOf(false) }

    val voiceHandler = remember {
        VoiceToTextHandler(
            context = context,
            onResult = { recognizedText -> text = recognizedText },
            onListeningStateChanged = { listening -> isListeningVoice = listening },
            onError = { error ->
                Toast.makeText(context, error, Toast.LENGTH_SHORT).show()
                isListeningVoice = false
            }
        )
    }

    DisposableEffect(Unit) {
        onDispose {
            voiceHandler.destroy()
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            voiceHandler.startListening()
        } else {
            Toast.makeText(context, "Microphone permission is required for voice input", Toast.LENGTH_SHORT).show()
        }
    }

    // Dialog for adding quick context doc
    var showAddContextDialog by remember { mutableStateOf(false) }
    var contextTitle by remember { mutableStateOf("") }
    var contextText by remember { mutableStateOf("") }

    if (showAddContextDialog) {
        AlertDialog(
            onDismissRequest = { showAddContextDialog = false },
            title = { Text("Attach Context to Prompt", color = TextPrimary) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = contextTitle,
                        onValueChange = { contextTitle = it },
                        label = { Text("Title / Source Name") },
                        placeholder = { Text("e.g. Project Notes or meeting_recap.txt") },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent,
                            unfocusedBorderColor = BorderSubtle
                        )
                    )
                    OutlinedTextField(
                        value = contextText,
                        onValueChange = { contextText = it },
                        label = { Text("Text or Markdown Content") },
                        placeholder = { Text("Paste document text, code, or context here...") },
                        modifier = Modifier.height(140.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent,
                            unfocusedBorderColor = BorderSubtle
                        )
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (contextText.isNotBlank()) {
                            onAddAttachment(
                                MessageAttachment(
                                    id = UUID.randomUUID().toString(),
                                    name = contextTitle.ifBlank { "attached-note.txt" },
                                    mimeType = "text/plain",
                                    sizeDisplay = "${(contextText.length / 1024).coerceAtLeast(1)} KB",
                                    previewText = contextText
                                )
                            )
                            contextTitle = ""
                            contextText = ""
                            showAddContextDialog = false
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark)
                ) {
                    Text("Attach", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showAddContextDialog = false }) {
                    Text("Cancel", color = TextSecondary)
                }
            },
            containerColor = SurfaceCard
        )
    }

    Surface(
        color = BackgroundDark,
        modifier = modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            // Mode Indicator Bar & Voice Recording indicator
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // 3-Way Mode Selector: Chat | Query | Agent
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(SurfaceCard)
                        .border(1.dp, BorderSubtle, RoundedCornerShape(12.dp))
                        .padding(2.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Chat mode pill
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (queryMode == QueryMode.CHAT) CyanAccent.copy(alpha = 0.2f) else Color.Transparent)
                            .clickable { onToggleQueryMode(QueryMode.CHAT) }
                            .padding(horizontal = 8.dp, vertical = 3.dp)
                    ) {
                        Text(
                            text = "Chat",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (queryMode == QueryMode.CHAT) CyanAccent else TextSecondary,
                            fontSize = 11.sp,
                            fontWeight = if (queryMode == QueryMode.CHAT) FontWeight.Bold else FontWeight.Normal
                        )
                    }

                    // Query RAG mode pill
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (queryMode == QueryMode.QUERY) PurpleReasoning.copy(alpha = 0.2f) else Color.Transparent)
                            .clickable { onToggleQueryMode(QueryMode.QUERY) }
                            .padding(horizontal = 8.dp, vertical = 3.dp)
                    ) {
                        Text(
                            text = "Query (RAG)",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (queryMode == QueryMode.QUERY) PurpleReasoning else TextSecondary,
                            fontSize = 11.sp,
                            fontWeight = if (queryMode == QueryMode.QUERY) FontWeight.Bold else FontWeight.Normal
                        )
                    }

                    // Agent Mode pill
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (queryMode == QueryMode.AGENT) AmberWarning.copy(alpha = 0.25f) else Color.Transparent)
                            .border(
                                1.dp,
                                if (queryMode == QueryMode.AGENT) AmberWarning.copy(alpha = 0.6f) else Color.Transparent,
                                RoundedCornerShape(10.dp)
                            )
                            .clickable { onToggleQueryMode(QueryMode.AGENT) }
                            .padding(horizontal = 8.dp, vertical = 3.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = "Agent ⚡",
                                style = MaterialTheme.typography.labelSmall,
                                color = if (queryMode == QueryMode.AGENT) AmberWarning else TextSecondary,
                                fontSize = 11.sp,
                                fontWeight = if (queryMode == QueryMode.AGENT) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }
                }

                // Voice Recording state
                if (isListeningVoice) {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(RedError.copy(alpha = 0.2f))
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(RedError)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Listening...",
                            style = MaterialTheme.typography.labelSmall,
                            color = RedError,
                            fontSize = 11.sp
                        )
                    }
                }
            }

            // Attached Context Chips
            if (attachments.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    attachments.forEach { att ->
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(SurfaceCard)
                                .border(1.dp, CyanAccent.copy(alpha = 0.4f), RoundedCornerShape(8.dp))
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.AttachFile,
                                contentDescription = null,
                                tint = CyanAccent,
                                modifier = Modifier.size(12.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = att.name,
                                style = MaterialTheme.typography.labelSmall,
                                color = TextPrimary
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Remove attachment",
                                tint = TextMuted,
                                modifier = Modifier
                                    .size(12.dp)
                                    .clickable { onRemoveAttachment(att.id) }
                            )
                        }
                    }
                }
            }

            // Main Input Pill
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(24.dp))
                    .background(SurfaceCard)
                    .border(1.dp, BorderSubtle, RoundedCornerShape(24.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Attach button with dropdown
                Box {
                    IconButton(
                        onClick = { attachMenuExpanded = true },
                        modifier = Modifier
                            .size(36.dp)
                            .testTag("attach_button")
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.AddCircleOutline,
                            contentDescription = "Attach file or context",
                            tint = TextSecondary,
                            modifier = Modifier.size(22.dp)
                        )
                    }

                    DropdownMenu(
                        expanded = attachMenuExpanded,
                        onDismissRequest = { attachMenuExpanded = false },
                        modifier = Modifier
                            .background(SurfaceCard)
                            .border(1.dp, BorderSubtle, RoundedCornerShape(8.dp))
                    ) {
                        DropdownMenuItem(
                            text = { Text("Attach Text / Note", color = TextPrimary) },
                            leadingIcon = { Icon(Icons.Outlined.NoteAdd, null, tint = CyanAccent) },
                            onClick = {
                                attachMenuExpanded = false
                                showAddContextDialog = true
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Sample Document (PDF)", color = TextPrimary) },
                            leadingIcon = { Icon(Icons.Outlined.PictureAsPdf, null, tint = BlueAccent) },
                            onClick = {
                                attachMenuExpanded = false
                                onAddAttachment(
                                    MessageAttachment(
                                        id = UUID.randomUUID().toString(),
                                        name = "project_specs.pdf",
                                        mimeType = "application/pdf",
                                        sizeDisplay = "1.2 MB",
                                        previewText = "System specifications and architecture goals."
                                    )
                                )
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Scrape Web Link", color = TextPrimary) },
                            leadingIcon = { Icon(Icons.Outlined.Link, null, tint = TealAccent) },
                            onClick = {
                                attachMenuExpanded = false
                                onAddAttachment(
                                    MessageAttachment(
                                        id = UUID.randomUUID().toString(),
                                        name = "https://docs.vukko.com",
                                        mimeType = "text/html",
                                        sizeDisplay = "Web Source",
                                        previewText = "Official Vukko documentation."
                                    )
                                )
                            }
                        )
                    }
                }

                // Text Input Field
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 8.dp, vertical = 8.dp)
                ) {
                    if (text.isEmpty()) {
                        Text(
                            text = when (queryMode) {
                                QueryMode.AGENT -> "Assign a multi-step task to the Agent..."
                                QueryMode.QUERY -> "Ask questions against your documents..."
                                QueryMode.CHAT -> "Send a message to Vukko..."
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextMuted
                        )
                    }
                    BasicTextField(
                        value = text,
                        onValueChange = { text = it },
                        textStyle = MaterialTheme.typography.bodyMedium.copy(color = TextPrimary),
                        cursorBrush = SolidColor(CyanAccent),
                        maxLines = 5,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("prompt_input_field")
                    )
                }

                // Microphone Voice toggle
                IconButton(
                    onClick = {
                        if (isListeningVoice) {
                            voiceHandler.stopListening()
                        } else {
                            val permissionCheck = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
                            if (permissionCheck == PackageManager.PERMISSION_GRANTED) {
                                voiceHandler.startListening()
                            } else {
                                permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        }
                    },
                    modifier = Modifier
                        .size(36.dp)
                        .testTag("mic_button")
                ) {
                    Icon(
                        imageVector = if (isListeningVoice) Icons.Filled.Mic else Icons.Outlined.MicNone,
                        contentDescription = "Voice Input",
                        tint = if (isListeningVoice) RedError else TextSecondary,
                        modifier = Modifier.size(20.dp)
                    )
                }

                // Send Button
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(if (text.isNotBlank() || attachments.isNotEmpty()) CyanAccent else SurfaceVariantDark)
                        .clickable(enabled = (text.isNotBlank() || attachments.isNotEmpty()) || isGenerating) {
                            if (!isGenerating && (text.isNotBlank() || attachments.isNotEmpty())) {
                                val toSend = text
                                text = ""
                                onSendMessage(toSend)
                            }
                        }
                        .testTag("send_button"),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = if (isGenerating) Icons.Filled.Stop else Icons.Filled.ArrowUpward,
                        contentDescription = if (isGenerating) "Stop Generation" else "Send Message",
                        tint = if (text.isNotBlank() || attachments.isNotEmpty()) BackgroundDark else TextMuted,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}
