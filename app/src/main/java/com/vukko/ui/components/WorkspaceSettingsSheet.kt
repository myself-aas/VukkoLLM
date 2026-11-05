package com.vukko.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Color
import com.vukko.model.*
import com.vukko.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspaceSettingsSheet(
    workspace: Workspace,
    documents: List<DocumentItem>,
    onUpdateWorkspace: (Workspace) -> Unit,
    onDeleteWorkspace: (String) -> Unit,
    onAddDocument: (name: String, type: DocumentType, content: String) -> Unit,
    onDeleteDocument: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var name by remember { mutableStateOf(workspace.name) }
    var description by remember { mutableStateOf(workspace.description) }
    var systemPrompt by remember { mutableStateOf(workspace.systemPrompt) }
    var temperature by remember { mutableFloatStateOf(workspace.temperature) }
    var queryMode by remember { mutableStateOf(workspace.queryMode) }
    var agentMaxSteps by remember { mutableIntStateOf(workspace.agentMaxSteps) }
    var agentAllowWebSearch by remember { mutableStateOf(workspace.agentAllowWebSearch) }
    var agentAllowFileCreation by remember { mutableStateOf(workspace.agentAllowFileCreation) }
    var agentAllowDocumentSearch by remember { mutableStateOf(workspace.agentAllowDocumentSearch) }

    var showAddDocDialog by remember { mutableStateOf(false) }
    var newDocTitle by remember { mutableStateOf("") }
    var newDocContent by remember { mutableStateOf("") }

    if (showAddDocDialog) {
        AlertDialog(
            onDismissRequest = { showAddDocDialog = false },
            title = { Text("Upload Document / Web Context", color = TextPrimary) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = newDocTitle,
                        onValueChange = { newDocTitle = it },
                        label = { Text("Document / Link Name") },
                        placeholder = { Text("e.g. system_architecture.md or API docs") },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent,
                            unfocusedBorderColor = BorderSubtle
                        )
                    )
                    OutlinedTextField(
                        value = newDocContent,
                        onValueChange = { newDocContent = it },
                        label = { Text("Document Content") },
                        placeholder = { Text("Paste document text, research notes or data...") },
                        modifier = Modifier.height(130.dp),
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
                        if (newDocTitle.isNotBlank() && newDocContent.isNotBlank()) {
                            onAddDocument(newDocTitle, DocumentType.MARKDOWN, newDocContent)
                            newDocTitle = ""
                            newDocContent = ""
                            showAddDocDialog = false
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark)
                ) {
                    Text("Add to Workspace", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showAddDocDialog = false }) {
                    Text("Cancel", color = TextSecondary)
                }
            },
            containerColor = SurfaceCard
        )
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = BackgroundDark,
        dragHandle = { BottomSheetDefaults.DragHandle(color = BorderSubtle) }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Workspace Settings",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )
                Button(
                    onClick = {
                        onUpdateWorkspace(
                            workspace.copy(
                                name = name,
                                description = description,
                                systemPrompt = systemPrompt,
                                temperature = temperature,
                                queryMode = queryMode,
                                agentMaxSteps = agentMaxSteps,
                                agentAllowWebSearch = agentAllowWebSearch,
                                agentAllowFileCreation = agentAllowFileCreation,
                                agentAllowDocumentSearch = agentAllowDocumentSearch
                            )
                        )
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.testTag("save_workspace_settings_button")
                ) {
                    Text("Save", fontWeight = FontWeight.Bold)
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 480.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Workspace Name") },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent,
                            unfocusedBorderColor = BorderSubtle
                        )
                    )
                }

                item {
                    OutlinedTextField(
                        value = description,
                        onValueChange = { description = it },
                        label = { Text("Description") },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent,
                            unfocusedBorderColor = BorderSubtle
                        )
                    )
                }

                item {
                    OutlinedTextField(
                        value = systemPrompt,
                        onValueChange = { systemPrompt = it },
                        label = { Text("System Instructions (Workspace Prompt)") },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(100.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent,
                            unfocusedBorderColor = BorderSubtle
                        )
                    )
                }

                item {
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("LLM Temperature: ${String.format("%.2f", temperature)}", style = MaterialTheme.typography.labelMedium, color = TextPrimary)
                            Text(if (temperature < 0.4f) "Precise" else if (temperature > 0.8f) "Creative" else "Balanced", style = MaterialTheme.typography.labelSmall, color = CyanAccent)
                        }
                        Slider(
                            value = temperature,
                            onValueChange = { temperature = it },
                            valueRange = 0f..1f,
                            colors = SliderDefaults.colors(
                                thumbColor = CyanAccent,
                                activeTrackColor = CyanAccent,
                                inactiveTrackColor = SurfaceVariantDark
                            )
                        )
                    }
                }

                // Workspace Mode Selector
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            text = "DEFAULT EXECUTION MODE",
                            style = MaterialTheme.typography.labelSmall,
                            color = TextMuted,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(SurfaceCard)
                                .border(1.dp, BorderSubtle, RoundedCornerShape(12.dp))
                                .padding(4.dp),
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            listOf(
                                Triple(QueryMode.CHAT, "Chat", CyanAccent),
                                Triple(QueryMode.QUERY, "Query (RAG)", PurpleReasoning),
                                Triple(QueryMode.AGENT, "Agent ⚡", AmberWarning)
                            ).forEach { (mode, title, color) ->
                                val isSelected = queryMode == mode
                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(if (isSelected) color.copy(alpha = 0.2f) else Color.Transparent)
                                        .border(
                                            1.dp,
                                            if (isSelected) color else Color.Transparent,
                                            RoundedCornerShape(8.dp)
                                        )
                                        .clickable { queryMode = mode }
                                        .padding(vertical = 8.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = title,
                                        style = MaterialTheme.typography.labelSmall,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                        color = if (isSelected) color else TextSecondary
                                    )
                                }
                            }
                        }
                    }
                }

                // Agent Configuration Card
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfaceCard),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(1.dp, AmberWarning.copy(alpha = 0.25f), RoundedCornerShape(12.dp))
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("⚡", fontSize = 16.sp)
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "Agent Capabilities & Skills",
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = AmberWarning
                                )
                            }

                            Text(
                                text = "Configure multi-step autonomous tool execution limits and permissions.",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextSecondary,
                                fontSize = 11.sp
                            )

                            // Max steps slider
                            Column {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text("Max Execution Steps: $agentMaxSteps", style = MaterialTheme.typography.labelSmall, color = TextPrimary)
                                    Text("Planning Limit", style = MaterialTheme.typography.labelSmall, color = TextMuted)
                                }
                                Slider(
                                    value = agentMaxSteps.toFloat(),
                                    onValueChange = { agentMaxSteps = it.toInt() },
                                    valueRange = 3f..10f,
                                    steps = 6,
                                    colors = SliderDefaults.colors(
                                        thumbColor = AmberWarning,
                                        activeTrackColor = AmberWarning,
                                        inactiveTrackColor = SurfaceVariantDark
                                    )
                                )
                            }

                            // Tool toggle: Web search
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Web Intelligence Search", style = MaterialTheme.typography.bodySmall, color = TextPrimary)
                                Switch(
                                    checked = agentAllowWebSearch,
                                    onCheckedChange = { agentAllowWebSearch = it },
                                    colors = SwitchDefaults.colors(checkedThumbColor = BackgroundDark, checkedTrackColor = AmberWarning)
                                )
                            }

                            // Tool toggle: File Creation
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Auto-Save Document Artifacts", style = MaterialTheme.typography.bodySmall, color = TextPrimary)
                                Switch(
                                    checked = agentAllowFileCreation,
                                    onCheckedChange = { agentAllowFileCreation = it },
                                    colors = SwitchDefaults.colors(checkedThumbColor = BackgroundDark, checkedTrackColor = AmberWarning)
                                )
                            }

                            // Tool toggle: Document RAG
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Workspace Knowledge Retrieval (RAG)", style = MaterialTheme.typography.bodySmall, color = TextPrimary)
                                Switch(
                                    checked = agentAllowDocumentSearch,
                                    onCheckedChange = { agentAllowDocumentSearch = it },
                                    colors = SwitchDefaults.colors(checkedThumbColor = BackgroundDark, checkedTrackColor = AmberWarning)
                                )
                            }
                        }
                    }
                }

                // Data Sovereignty & Local Storage Info Card
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfaceCard),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(1.dp, SuccessGreen.copy(alpha = 0.3f), RoundedCornerShape(12.dp))
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("🔒", fontSize = 16.sp)
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "Local Storage & Data Sovereignty",
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = SuccessGreen
                                )
                            }
                            Text(
                                text = "All threads, prompt overrides, vector knowledge chunks, and agent artifacts for '${workspace.name}' are stored directly in your device's Room database (vukko_sovereign.db). No chats are sent to third-party databases.",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextSecondary,
                                fontSize = 11.sp,
                                lineHeight = 16.sp
                            )
                        }
                    }
                }

                item {
                    // Documents Section Header
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "KNOWLEDGE BASE (${documents.size} DOCS)",
                            style = MaterialTheme.typography.labelSmall,
                            color = TextMuted,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp
                        )
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .clickable { showAddDocDialog = true }
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.Add, null, tint = CyanAccent, modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(3.dp))
                            Text("Add Doc", style = MaterialTheme.typography.labelSmall, color = CyanAccent)
                        }
                    }
                }

                items(documents) { doc ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(SurfaceCard)
                            .border(1.dp, BorderSubtle, RoundedCornerShape(8.dp))
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Description,
                                contentDescription = null,
                                tint = CyanAccent,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Column {
                                Text(
                                    text = doc.name,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextPrimary,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = "${doc.size} • ${doc.vectorCount} vectors",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = TextMuted,
                                    fontSize = 11.sp
                                )
                            }
                        }

                        IconButton(
                            onClick = { onDeleteDocument(doc.id) },
                            modifier = Modifier.size(24.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Delete,
                                contentDescription = "Delete Document",
                                tint = RedError,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                }

                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = {
                            onDeleteWorkspace(workspace.id)
                            onDismiss()
                        },
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = RedError),
                        border = androidx.compose.foundation.BorderStroke(1.dp, RedError.copy(alpha = 0.5f)),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Delete, null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Delete Workspace", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}
