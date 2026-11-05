package com.vukko.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vukko.R
import com.vukko.model.Workspace
import com.vukko.model.WorkspaceThread
import com.vukko.theme.*

@Composable
fun WorkspaceDrawer(
    workspaces: List<Workspace>,
    activeWorkspaceId: String,
    threads: List<WorkspaceThread>,
    activeThreadId: String,
    onSelectWorkspace: (Workspace) -> Unit,
    onSelectThread: (WorkspaceThread) -> Unit,
    onNewWorkspace: () -> Unit,
    onNewThread: () -> Unit,
    onDeleteThread: (String) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenInstanceConnect: () -> Unit,
    onOpenSovereignStorage: () -> Unit,
    onOpenGitHubManager: () -> Unit,
    modifier: Modifier = Modifier
) {
    var searchQuery by remember { mutableStateOf("") }

    ModalDrawerSheet(
        modifier = modifier
            .fillMaxHeight()
            .width(320.dp),
        drawerContainerColor = BackgroundDark,
        drawerContentColor = TextPrimary
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            // Header: Official Vukko Logo & New Workspace button
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Image(
                        painter = painterResource(id = R.drawable.anything_llm_icon),
                        contentDescription = "Vukko Logo",
                        modifier = Modifier
                            .size(36.dp)
                            .clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Fit
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            text = "Vukko",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                        Text(
                            text = "Air-Gapped Sovereign AI",
                            style = MaterialTheme.typography.labelSmall,
                            color = SuccessGreen
                        )
                    }
                }

                FilledTonalIconButton(
                    onClick = onNewWorkspace,
                    colors = IconButtonDefaults.filledTonalIconButtonColors(
                        containerColor = SurfaceCard,
                        contentColor = CyanAccent
                    ),
                    modifier = Modifier
                        .size(36.dp)
                        .testTag("new_workspace_button")
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = "Create Workspace",
                        modifier = Modifier.size(20.dp)
                    )
                }
            }

            HorizontalDivider(color = BorderSubtle, thickness = 1.dp)

            // Thread & Chat History Search Input
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                placeholder = {
                    Text(
                        text = "Search chat history...",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = "Search history",
                        tint = TextSecondary,
                        modifier = Modifier.size(16.dp)
                    )
                },
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(
                            onClick = { searchQuery = "" },
                            modifier = Modifier.size(20.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Clear search",
                                tint = TextSecondary,
                                modifier = Modifier.size(14.dp)
                            )
                        }
                    }
                },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodySmall.copy(color = TextPrimary),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    focusedBorderColor = CyanAccent,
                    unfocusedBorderColor = BorderSubtle,
                    focusedContainerColor = SurfaceCard,
                    unfocusedContainerColor = SurfaceCard
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp)
                    .testTag("thread_search_input")
            )

            // Section Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "WORKSPACES",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = TextMuted,
                    letterSpacing = 1.sp
                )
                Text(
                    text = "${workspaces.size}",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextMuted
                )
            }

            // Workspaces list
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 12.dp)
            ) {
                items(workspaces) { ws ->
                    val isActive = ws.id == activeWorkspaceId
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                    ) {
                        // Workspace Card
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(if (isActive) SurfaceCard else Color.Transparent)
                                .border(
                                    1.dp,
                                    if (isActive) CyanAccent.copy(alpha = 0.5f) else Color.Transparent,
                                    RoundedCornerShape(12.dp)
                                )
                                .clickable { onSelectWorkspace(ws) }
                                .padding(horizontal = 12.dp, vertical = 10.dp)
                                .testTag("workspace_item_${ws.id}"),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(32.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isActive) CyanAccent.copy(alpha = 0.2f) else SurfaceVariantDark),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = if (isActive) Icons.Filled.FolderOpen else Icons.Outlined.Folder,
                                    contentDescription = null,
                                    tint = if (isActive) CyanAccent else TextSecondary,
                                    modifier = Modifier.size(18.dp)
                                )
                            }

                            Spacer(modifier = Modifier.width(10.dp))

                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = ws.name,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Normal,
                                    color = if (isActive) TextPrimary else TextSecondary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = "${ws.documentCount} docs • ${ws.vectorCount} vectors",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = TextMuted
                                    )
                                }
                            }
                        }

                        // If active workspace, list its threads
                        if (isActive) {
                            val filteredThreads = remember(threads, searchQuery) {
                                if (searchQuery.isBlank()) threads
                                else threads.filter { th ->
                                    th.name.contains(searchQuery, ignoreCase = true) ||
                                    (th.lastMessageSnippet?.contains(searchQuery, ignoreCase = true) == true)
                                }
                            }

                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(start = 24.dp, end = 4.dp, top = 4.dp)
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 4.dp, horizontal = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = if (searchQuery.isBlank()) "THREADS" else "SEARCH RESULTS (${filteredThreads.size})",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (searchQuery.isBlank()) TextMuted else CyanAccent,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                    Row(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(6.dp))
                                            .clickable { onNewThread() }
                                            .padding(horizontal = 6.dp, vertical = 2.dp)
                                            .testTag("new_thread_button"),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(
                                            Icons.Default.Add,
                                            contentDescription = "New Thread",
                                            tint = CyanAccent,
                                            modifier = Modifier.size(12.dp)
                                        )
                                        Spacer(modifier = Modifier.width(2.dp))
                                        Text(
                                            text = "New Thread",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = CyanAccent,
                                            fontSize = 11.sp
                                        )
                                    }
                                }

                                if (filteredThreads.isEmpty() && searchQuery.isNotBlank()) {
                                    Text(
                                        text = "No matching conversations found",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = TextMuted,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)
                                    )
                                }

                                filteredThreads.forEach { th ->
                                    val isThActive = th.id == activeThreadId
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(if (isThActive) CyanAccent.copy(alpha = 0.12f) else Color.Transparent)
                                            .clickable { onSelectThread(th) }
                                            .padding(horizontal = 8.dp, vertical = 6.dp)
                                            .testTag("thread_item_${th.id}"),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(
                                            imageVector = Icons.Outlined.ChatBubbleOutline,
                                            contentDescription = null,
                                            tint = if (isThActive) CyanAccent else TextMuted,
                                            modifier = Modifier.size(14.dp)
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                text = th.name,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = if (isThActive) CyanAccent else TextSecondary,
                                                fontWeight = if (isThActive) FontWeight.Medium else FontWeight.Normal,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            if (!th.lastMessageSnippet.isNullOrBlank()) {
                                                Text(
                                                    text = th.lastMessageSnippet,
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = TextMuted,
                                                    maxLines = 1,
                                                    fontSize = 10.sp,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                            }
                                        }
                                        if (threads.size > 1) {
                                            IconButton(
                                                onClick = { onDeleteThread(th.id) },
                                                modifier = Modifier.size(24.dp)
                                            ) {
                                                Icon(
                                                    Icons.Outlined.Close,
                                                    contentDescription = "Delete Thread",
                                                    tint = TextMuted,
                                                    modifier = Modifier.size(12.dp)
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

            HorizontalDivider(color = BorderSubtle, thickness = 1.dp)

            // Bottom drawer footer
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // Data Sovereignty / Room DB shortcut
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(SuccessGreen.copy(alpha = 0.08f))
                        .border(1.dp, SuccessGreen.copy(alpha = 0.25f), RoundedCornerShape(8.dp))
                        .clickable { onOpenSovereignStorage() }
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                        .testTag("drawer_sovereign_storage"),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Shield,
                        contentDescription = null,
                        tint = SuccessGreen,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            text = "Data Sovereignty (Room DB)",
                            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                            color = TextPrimary
                        )
                        Text(
                            text = "On-Device Storage • 0% Cloud Leak",
                            style = MaterialTheme.typography.labelSmall,
                            color = SuccessGreen
                        )
                    }
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onOpenGitHubManager() }
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                        .testTag("drawer_github_manager"),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Code,
                        contentDescription = null,
                        tint = CyanAccent,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            text = "GitHub Repos & PRs",
                            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                            color = TextPrimary
                        )
                        Text(
                            text = "Commit, Push, PRs & Admin RAG",
                            style = MaterialTheme.typography.labelSmall,
                            color = TextSecondary
                        )
                    }
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onOpenInstanceConnect() }
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                        .testTag("drawer_instance_connect"),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Outlined.CloudSync,
                        contentDescription = null,
                        tint = TealAccent,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Column {
                        Text(
                            text = "Connect to Instance",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                            color = TextPrimary
                        )
                        Text(
                            text = "Sync with Desktop / Server",
                            style = MaterialTheme.typography.labelSmall,
                            color = TextSecondary
                        )
                    }
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onOpenSettings() }
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                        .testTag("drawer_settings"),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Settings,
                        contentDescription = null,
                        tint = TextSecondary,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = "Settings & Providers",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextPrimary
                    )
                }
            }
        }
    }
}
