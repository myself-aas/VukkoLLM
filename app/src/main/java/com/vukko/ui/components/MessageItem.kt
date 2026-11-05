package com.vukko.ui.components

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vukko.R
import com.vukko.model.*
import com.vukko.theme.*
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.Date
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput

@Composable
fun MessageItem(
    message: ChatMessage,
    onCitationClick: (Citation) -> Unit,
    onDeleteMessage: ((String) -> Unit)? = null,
    onToggleFavorite: ((String, Boolean) -> Unit)? = null,
    onCategorizeMessage: ((ChatMessage) -> Unit)? = null,
    isReaderMode: Boolean = false,
    modifier: Modifier = Modifier
) {
    val isUser = message.sender == MessageSender.USER
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current
    val timeFormat = remember { SimpleDateFormat("h:mm a", Locale.getDefault()) }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = if (isReaderMode) 24.dp else 12.dp, vertical = if (isReaderMode) 12.dp else 6.dp),
        horizontalArrangement = if (isReaderMode) Arrangement.Start else (if (isUser) Arrangement.End else Arrangement.Start)
    ) {
        if (!isUser && !isReaderMode) {
            // Assistant Avatar
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(SurfaceCard)
                    .border(1.dp, BorderSubtle, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Image(
                    painter = painterResource(id = R.drawable.anything_llm_icon),
                    contentDescription = "Assistant",
                    modifier = Modifier.size(20.dp)
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
        }

        Column(
            modifier = Modifier.widthIn(max = if (isReaderMode) 800.dp else 330.dp),
            horizontalAlignment = if (isReaderMode) Alignment.Start else (if (isUser) Alignment.End else Alignment.Start)
        ) {
            if (isReaderMode) {
                Text(
                    text = if (isUser) "YOU" else "VUKKO",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (isUser) CyanAccent else TealAccent,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp,
                    modifier = Modifier.padding(bottom = 4.dp)
                )
            }
            // Attachments if any
            if (message.attachments.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .padding(bottom = 6.dp)
                        .horizontalScroll(androidx.compose.foundation.rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    message.attachments.forEach { att ->
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(SurfaceCard)
                                .border(1.dp, BorderSubtle, RoundedCornerShape(8.dp))
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.AttachFile,
                                contentDescription = null,
                                tint = CyanAccent,
                                modifier = Modifier.size(14.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = att.name,
                                style = MaterialTheme.typography.labelSmall,
                                color = TextPrimary
                            )
                        }
                    }
                }
            }

            // Agent Multi-Step Execution Pipeline
            if (!isUser && message.isAgentExecution && message.agentSteps.isNotEmpty()) {
                AgentActivityChain(
                    steps = message.agentSteps,
                    isStreaming = message.isStreaming,
                    modifier = Modifier.padding(bottom = 8.dp)
                )
            }

            // Chain of Thought (Thinking) Accordion for Assistant
            if (!isUser && !message.thinking.isNullOrBlank()) {
                var thinkingExpanded by remember { mutableStateOf(false) }
                val rotationAngle by animateFloatAsState(targetValue = if (thinkingExpanded) 180f else 0f)

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 6.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(SurfaceVariantDark.copy(alpha = 0.5f))
                        .border(1.dp, PurpleReasoning.copy(alpha = 0.25f), RoundedCornerShape(10.dp))
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { thinkingExpanded = !thinkingExpanded }
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Outlined.Psychology,
                                contentDescription = "Thought Process",
                                tint = PurpleReasoning,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = if (message.thinkingDurationMs != null) {
                                    "Thought for ${String.format(Locale.US, "%.1f", message.thinkingDurationMs / 1000f)}s"
                                } else {
                                    "Reasoning process"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = PurpleReasoning,
                                fontWeight = FontWeight.SemiBold
                            )
                        }

                        Icon(
                            imageVector = Icons.Default.KeyboardArrowDown,
                            contentDescription = "Toggle thought details",
                            tint = PurpleReasoning,
                            modifier = Modifier
                                .size(16.dp)
                                .rotate(rotationAngle)
                        )
                    }

                    AnimatedVisibility(visible = thinkingExpanded) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(BackgroundDark.copy(alpha = 0.7f))
                                .padding(10.dp)
                        ) {
                            Text(
                                text = message.thinking,
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                                color = TextSecondary,
                                fontSize = 12.sp,
                                lineHeight = 16.sp
                            )
                        }
                    }
                }
            }

            // Message Tags Display
            if (message.tags.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .padding(bottom = 6.dp)
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    message.tags.forEach { tag ->
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(CyanAccent.copy(alpha = 0.1f))
                                .border(1.dp, CyanAccent.copy(alpha = 0.3f), RoundedCornerShape(4.dp))
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text(
                                text = tag,
                                style = MaterialTheme.typography.labelSmall,
                                color = CyanAccent,
                                fontSize = 10.sp
                            )
                        }
                    }
                }
            }

            // Tools used badge if any
            if (!isUser && message.toolsUsed.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    message.toolsUsed.forEach { tool ->
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(TealAccent.copy(alpha = 0.1f))
                                .border(1.dp, TealAccent.copy(alpha = 0.3f), RoundedCornerShape(6.dp))
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Build,
                                contentDescription = null,
                                tint = TealAccent,
                                modifier = Modifier.size(12.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Tool: ${tool.toolName} (${tool.output})",
                                style = MaterialTheme.typography.labelSmall,
                                color = TealAccent,
                                fontSize = 11.sp,
                                maxLines = 1
                            )
                        }
                    }
                }
            }

            var showContextMenu by remember { mutableStateOf(false) }

            // Main Message Content Box
            Box(
                modifier = Modifier
                    .clip(
                        RoundedCornerShape(
                            topStart = 16.dp,
                            topEnd = 16.dp,
                            bottomStart = if (isUser) 16.dp else 4.dp,
                            bottomEnd = if (isUser) 4.dp else 16.dp
                        )
                    )
                    .background(
                        if (isReaderMode) Color.Transparent 
                        else if (isUser) UserBubbleColor 
                        else AssistantCardColor
                    )
                    .then(
                        if (isReaderMode) Modifier 
                        else Modifier.border(
                            1.dp,
                            if (isUser) BorderSubtle else BorderSubtle.copy(alpha = 0.7f),
                            RoundedCornerShape(
                                topStart = 16.dp,
                                topEnd = 16.dp,
                                bottomStart = if (isUser) 16.dp else 4.dp,
                                bottomEnd = if (isUser) 4.dp else 16.dp
                            )
                        )
                    )
                    .pointerInput(message.id) {
                        detectTapGestures(
                            onLongPress = {
                                showContextMenu = true
                            }
                        )
                    }
                    .padding(if (isReaderMode) 0.dp else 14.dp)
                    .testTag(if (isUser) "user_message_${message.id}" else "assistant_message_${message.id}")
            ) {
                Column {
                    MarkdownText(
                        markdown = message.content,
                        textColor = TextPrimary,
                        fontSize = if (isReaderMode) 16.sp else 14.sp
                    )

                    if (message.isStreaming) {
                        Spacer(modifier = Modifier.height(6.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(6.dp)
                                    .clip(CircleShape)
                                    .background(CyanAccent)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Generating...",
                                style = MaterialTheme.typography.labelSmall,
                                color = CyanAccent
                            )
                        }
                    }
                }

                // Long-Press Context Menu
                DropdownMenu(
                    expanded = showContextMenu,
                    onDismissRequest = { showContextMenu = false },
                    modifier = Modifier
                        .background(SurfaceCard)
                        .border(1.dp, BorderSubtle, RoundedCornerShape(8.dp))
                ) {
                    DropdownMenuItem(
                        text = { Text("Copy Message", color = TextPrimary) },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Outlined.ContentCopy,
                                contentDescription = "Copy message",
                                tint = CyanAccent
                            )
                        },
                        onClick = {
                            showContextMenu = false
                            clipboardManager.setText(AnnotatedString(message.content))
                            Toast.makeText(context, "Message copied to clipboard", Toast.LENGTH_SHORT).show()
                        },
                        modifier = Modifier.testTag("copy_message_option")
                    )
                    DropdownMenuItem(
                        text = {
                            Text(
                                text = if (message.isFavorite) "Remove Bookmark" else "Bookmark Message",
                                color = TextPrimary
                            )
                        },
                        leadingIcon = {
                            Icon(
                                imageVector = if (message.isFavorite) Icons.Filled.Star else Icons.Outlined.StarBorder,
                                contentDescription = "Bookmark message",
                                tint = AnythingAmber
                            )
                        },
                        onClick = {
                            showContextMenu = false
                            onToggleFavorite?.invoke(message.id, !message.isFavorite)
                        },
                        modifier = Modifier.testTag("favorite_message_option")
                    )
                    DropdownMenuItem(
                        text = { Text("Categorize / Label", color = TextPrimary) },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Outlined.Label,
                                contentDescription = "Categorize message",
                                tint = CyanAccent
                            )
                        },
                        onClick = {
                            showContextMenu = false
                            onCategorizeMessage?.invoke(message)
                        },
                        modifier = Modifier.testTag("categorize_message_option")
                    )
                    HorizontalDivider(color = BorderSubtle, modifier = Modifier.padding(vertical = 4.dp))
                    DropdownMenuItem(
                        text = { Text("Delete Message", color = RedError) },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Outlined.Delete,
                                contentDescription = "Delete message",
                                tint = RedError
                            )
                        },
                        onClick = {
                            showContextMenu = false
                            onDeleteMessage?.invoke(message.id)
                            Toast.makeText(context, "Message deleted", Toast.LENGTH_SHORT).show()
                        },
                        modifier = Modifier.testTag("delete_message_option")
                    )
                }
            }

            // Created Document Artifact Card
            if (!isUser && message.createdDocumentName != null) {
                Spacer(modifier = Modifier.height(6.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(TealAccent.copy(alpha = 0.12f))
                        .border(1.dp, TealAccent.copy(alpha = 0.4f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Article,
                        contentDescription = null,
                        tint = TealAccent,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "New Knowledge Base Document Created",
                            style = MaterialTheme.typography.labelSmall,
                            color = TealAccent,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp
                        )
                        Text(
                            text = message.createdDocumentName,
                            style = MaterialTheme.typography.bodySmall,
                            color = TextPrimary,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(TealAccent.copy(alpha = 0.2f))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = "Saved",
                            style = MaterialTheme.typography.labelSmall,
                            color = TealAccent,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }

            // Citations Chips if any
            if (!isUser && message.citations.isNotEmpty()) {
                Spacer(modifier = Modifier.height(6.dp))
                Column {
                    Text(
                        text = "SOURCES & CITATIONS",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMuted,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.5.sp
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(androidx.compose.foundation.rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        message.citations.forEach { citation ->
                            Row(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(SurfaceCard)
                                    .border(1.dp, BorderSubtle, RoundedCornerShape(8.dp))
                                    .clickable { onCitationClick(citation) }
                                    .padding(horizontal = 8.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Description,
                                    contentDescription = null,
                                    tint = BlueAccent,
                                    modifier = Modifier.size(13.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = citation.title,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = TextPrimary,
                                    maxLines = 1
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "${(citation.score * 100).toInt()}%",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = CyanAccent,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 10.sp
                                )
                            }
                        }
                    }
                }
            }

            // Message actions & timestamp row
            Row(
                modifier = Modifier
                    .padding(top = 4.dp, start = 4.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = timeFormat.format(Date(message.timestamp)),
                    style = MaterialTheme.typography.labelSmall,
                    color = TextMuted,
                    fontSize = 10.sp
                )

                if (!isUser) {
                    Spacer(modifier = Modifier.width(8.dp))
                    Icon(
                        imageVector = Icons.Outlined.ContentCopy,
                        contentDescription = "Copy message",
                        tint = TextMuted,
                        modifier = Modifier
                            .size(14.dp)
                            .clickable {
                                clipboardManager.setText(AnnotatedString(message.content))
                                Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
                            }
                    )
                }
            }
        }
    }
}

@Composable
fun AgentActivityChain(
    steps: List<AgentStep>,
    isStreaming: Boolean,
    modifier: Modifier = Modifier
) {
    var isExpanded by remember { mutableStateOf(true) }
    val completedCount = steps.count { it.status == AgentStepStatus.COMPLETED }
    val totalCount = steps.size
    val rotationAngle by animateFloatAsState(targetValue = if (isExpanded) 180f else 0f)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(SurfaceCard)
            .border(1.dp, CyanAccent.copy(alpha = 0.35f), RoundedCornerShape(12.dp))
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { isExpanded = !isExpanded }
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(24.dp)
                        .clip(CircleShape)
                        .background(CyanAccent.copy(alpha = 0.2f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Bolt,
                        contentDescription = "Agent Execution",
                        tint = CyanAccent,
                        modifier = Modifier.size(14.dp)
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                    Text(
                        text = "AGENT ACTIVITY CHAIN",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = CyanAccent,
                        letterSpacing = 0.5.sp,
                        fontSize = 10.sp
                    )
                    Text(
                        text = if (completedCount == totalCount) {
                            "Completed all $totalCount tasks successfully ✓"
                        } else {
                            "Running step ${completedCount + 1} of $totalCount..."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (completedCount == totalCount) GreenSuccess else TextSecondary,
                        fontWeight = FontWeight.Medium
                    )
                }
            }

            Icon(
                imageVector = Icons.Default.KeyboardArrowDown,
                contentDescription = "Expand/Collapse",
                tint = TextSecondary,
                modifier = Modifier
                    .size(18.dp)
                    .rotate(rotationAngle)
            )
        }

        // Steps Progress
        AnimatedVisibility(visible = isExpanded) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                HorizontalDivider(color = BorderSubtle, thickness = 1.dp)

                steps.forEach { step ->
                    var showDetails by remember { mutableStateOf(false) }

                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(
                                when (step.status) {
                                    AgentStepStatus.RUNNING -> CyanAccent.copy(alpha = 0.08f)
                                    AgentStepStatus.COMPLETED -> SurfaceDark
                                    else -> Color.Transparent
                                }
                            )
                            .clickable { showDetails = !showDetails }
                            .padding(8.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            // Status indicator
                            when (step.status) {
                                AgentStepStatus.COMPLETED -> {
                                    Icon(
                                        imageVector = Icons.Outlined.CheckCircle,
                                        contentDescription = "Done",
                                        tint = GreenSuccess,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                                AgentStepStatus.RUNNING -> {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(14.dp),
                                        color = CyanAccent,
                                        strokeWidth = 2.dp
                                    )
                                }
                                AgentStepStatus.FAILED -> {
                                    Icon(
                                        imageVector = Icons.Default.Close,
                                        contentDescription = "Failed",
                                        tint = RedError,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                                AgentStepStatus.PENDING -> {
                                    Icon(
                                        imageVector = Icons.Outlined.RadioButtonUnchecked,
                                        contentDescription = "Pending",
                                        tint = TextMuted,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.width(8.dp))

                            Text(
                                text = "Step ${step.stepIndex}: ${step.title}",
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = if (step.status == AgentStepStatus.RUNNING) FontWeight.Bold else FontWeight.Medium,
                                color = when (step.status) {
                                    AgentStepStatus.RUNNING -> CyanAccent
                                    AgentStepStatus.COMPLETED -> TextPrimary
                                    else -> TextMuted
                                },
                                modifier = Modifier.weight(1f)
                            )

                            // Tool tag
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(SurfaceVariantDark)
                                    .padding(horizontal = 6.dp, vertical = 2.dp)
                            ) {
                                Text(
                                    text = step.toolName,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = TealAccent,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }

                        // Step description
                        Text(
                            text = step.description,
                            style = MaterialTheme.typography.labelSmall,
                            color = TextSecondary,
                            modifier = Modifier.padding(start = 24.dp, top = 2.dp)
                        )

                        // Expandable Tool Input/Output Details
                        if (showDetails && (step.toolInput != null || step.toolOutput != null)) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(start = 24.dp, top = 6.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(CodeBlockBackground)
                                    .padding(8.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                if (!step.toolInput.isNullOrBlank()) {
                                    Text(
                                        text = "INPUT: ${step.toolInput}",
                                        style = MaterialTheme.typography.labelSmall,
                                        fontFamily = FontFamily.Monospace,
                                        color = TextSecondary,
                                        fontSize = 10.sp
                                    )
                                }
                                if (!step.toolOutput.isNullOrBlank()) {
                                    Text(
                                        text = "OUTPUT: ${step.toolOutput}",
                                        style = MaterialTheme.typography.labelSmall,
                                        fontFamily = FontFamily.Monospace,
                                        color = CyanAccent,
                                        fontSize = 10.sp
                                    )
                                }
                                if (step.executionTimeMs != null) {
                                    Text(
                                        text = "Duration: ${step.executionTimeMs}ms",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = TextMuted,
                                        fontSize = 9.sp
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

