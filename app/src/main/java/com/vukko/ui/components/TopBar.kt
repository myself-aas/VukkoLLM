package com.vukko.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vukko.R
import com.vukko.model.LLMModel
import com.vukko.model.Workspace
import com.vukko.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TopBar(
    activeWorkspace: Workspace?,
    threadTitle: String,
    selectedModel: LLMModel,
    onOpenDrawer: () -> Unit,
    onOpenModelPicker: () -> Unit,
    onOpenWorkspaceSettings: () -> Unit,
    onOpenQuickActions: () -> Unit,
    onOpenInstanceConnect: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSovereignStorage: () -> Unit,
    onOpenGitHubManager: () -> Unit,
    onExportThread: () -> Unit,
    onClearHistory: () -> Unit,
    isReaderMode: Boolean,
    onToggleReaderMode: (Boolean) -> Unit
) {
    var menuExpanded by remember { mutableStateOf(false) }

    Surface(
        color = BackgroundDark,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Drawer toggle
                IconButton(
                    onClick = onOpenDrawer,
                    modifier = Modifier.testTag("drawer_button")
                ) {
                    Icon(
                        imageVector = Icons.Default.Menu,
                        contentDescription = "Open Workspace Drawer",
                        tint = TextPrimary
                    )
                }

                // Workspace title & Thread info
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 6.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = activeWorkspace?.name ?: "Vukko",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        // Sovereign badge
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(SuccessGreen.copy(alpha = 0.15f))
                                .clickable { onOpenSovereignStorage() }
                                .padding(horizontal = 4.dp, vertical = 2.dp)
                                .testTag("topbar_sovereign_badge"),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "🔒 LOCAL DB",
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = SuccessGreen
                                )
                            )
                        }
                    }
                    Text(
                        text = threadTitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = TextSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                // Model Chip
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(16.dp))
                        .background(SurfaceCard)
                        .border(1.dp, BorderSubtle, RoundedCornerShape(16.dp))
                        .clickable { onOpenModelPicker() }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                        .testTag("model_picker_chip"),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Image(
                        painter = painterResource(id = selectedModel.provider.iconRes),
                        contentDescription = selectedModel.provider.displayName,
                        modifier = Modifier
                            .size(18.dp)
                            .clip(RoundedCornerShape(4.dp)),
                        contentScale = ContentScale.Fit
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = selectedModel.name.take(15),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = TextPrimary,
                        maxLines = 1
                    )
                    Spacer(modifier = Modifier.width(2.dp))
                    Icon(
                        imageVector = Icons.Default.KeyboardArrowDown,
                        contentDescription = "Switch Model",
                        tint = TextSecondary,
                        modifier = Modifier.size(16.dp)
                    )
                }

                // Overflow menu
                Box {
                    IconButton(
                        onClick = { menuExpanded = true },
                        modifier = Modifier.testTag("overflow_menu_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.MoreVert,
                            contentDescription = "Workspace Actions",
                            tint = TextPrimary
                        )
                    }

                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false },
                        modifier = Modifier
                            .background(SurfaceCard)
                            .border(1.dp, BorderSubtle, RoundedCornerShape(8.dp))
                    ) {
                        DropdownMenuItem(
                            text = { Text(if (isReaderMode) "Exit Reader Mode" else "Reader Mode", color = TextPrimary) },
                            leadingIcon = { Icon(if (isReaderMode) Icons.Default.CloseFullscreen else Icons.Outlined.AutoStories, null, tint = CyanAccent) },
                            onClick = {
                                menuExpanded = false
                                onToggleReaderMode(!isReaderMode)
                            }
                        )
                        HorizontalDivider(color = BorderSubtle, modifier = Modifier.padding(vertical = 4.dp))
                        DropdownMenuItem(
                            text = { Text("Data Sovereignty (Room DB)", color = TextPrimary) },
                            leadingIcon = { Icon(Icons.Default.Shield, null, tint = SuccessGreen) },
                            onClick = {
                                menuExpanded = false
                                onOpenSovereignStorage()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("GitHub Repos, Commits & PRs", color = TextPrimary) },
                            leadingIcon = { Icon(Icons.Default.Code, null, tint = CyanAccent) },
                            onClick = {
                                menuExpanded = false
                                onOpenGitHubManager()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Quick Actions (Process Text)", color = TextPrimary) },
                            leadingIcon = { Icon(Icons.Outlined.Bolt, null, tint = CyanAccent) },
                            onClick = {
                                menuExpanded = false
                                onOpenQuickActions()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Workspace & Documents", color = TextPrimary) },
                            leadingIcon = { Icon(Icons.Outlined.Folder, null, tint = BlueAccent) },
                            onClick = {
                                menuExpanded = false
                                onOpenWorkspaceSettings()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Connect to Instance", color = TextPrimary) },
                            leadingIcon = { Icon(Icons.Outlined.CloudSync, null, tint = TealAccent) },
                            onClick = {
                                menuExpanded = false
                                onOpenInstanceConnect()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Export Chat", color = TextPrimary) },
                            leadingIcon = { Icon(Icons.Outlined.FileDownload, null, tint = TextSecondary) },
                            onClick = {
                                menuExpanded = false
                                onExportThread()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Settings & API Keys", color = TextPrimary) },
                            leadingIcon = { Icon(Icons.Outlined.Settings, null, tint = TextSecondary) },
                            onClick = {
                                menuExpanded = false
                                onOpenSettings()
                            }
                        )
                        HorizontalDivider(color = BorderSubtle, modifier = Modifier.padding(vertical = 4.dp))
                        DropdownMenuItem(
                            text = { Text("Clear Chat History", color = RedError) },
                            leadingIcon = { Icon(Icons.Outlined.DeleteOutline, null, tint = RedError) },
                            onClick = {
                                menuExpanded = false
                                onClearHistory()
                            }
                        )
                    }
                }
            }

            HorizontalDivider(color = BorderSubtle, thickness = 1.dp)
        }
    }
}
