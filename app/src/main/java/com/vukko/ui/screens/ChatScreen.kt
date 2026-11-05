package com.vukko.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vukko.R
import com.vukko.model.ChatMessage
import com.vukko.model.Citation
import com.vukko.theme.*
import com.vukko.ui.components.*
import com.vukko.viewmodel.MainViewModel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(viewModel: MainViewModel) {
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val coroutineScope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    val workspaces by viewModel.workspaces.collectAsState()
    val activeWorkspaceId by viewModel.activeWorkspaceId.collectAsState()
    val activeWorkspace by viewModel.activeWorkspace.collectAsState()

    val threads by viewModel.threads.collectAsState()
    val activeThreadId by viewModel.activeThreadId.collectAsState()
    val activeThread by viewModel.activeThread.collectAsState()

    val messages by viewModel.messages.collectAsState()
    val documents by viewModel.documents.collectAsState()
    val selectedModel by viewModel.selectedModel.collectAsState()
    val selectedProvider by viewModel.selectedProvider.collectAsState()
    val isGenerating by viewModel.isGenerating.collectAsState()
    val attachments by viewModel.attachments.collectAsState()

    val showModelPicker by viewModel.showModelPicker.collectAsState()
    val showWorkspaceSettings by viewModel.showWorkspaceSettings.collectAsState()
    val showNewWorkspace by viewModel.showNewWorkspace.collectAsState()
    val showNewThread by viewModel.showNewThread.collectAsState()
    val showQuickActions by viewModel.showQuickActions.collectAsState()
    val showInstanceConnect by viewModel.showInstanceConnect.collectAsState()
    val showSettings by viewModel.showSettings.collectAsState()
    val showExportDialog by viewModel.showExportDialog.collectAsState()
    val showSovereignStorageDialog by viewModel.showSovereignStorageDialog.collectAsState()
    val sovereignStats by viewModel.sovereignStats.collectAsState()
    val exportData by viewModel.exportData.collectAsState()

    val showGitHubManager by viewModel.showGitHubManager.collectAsState()
    val gitHubRepositories by viewModel.gitHubRepositories.collectAsState()
    val gitHubPullRequests by viewModel.gitHubPullRequests.collectAsState()
    val gitHubCommits by viewModel.gitHubCommits.collectAsState()
    val gitHubOAuthState by viewModel.gitHubOAuthState.collectAsState()
    val readerModeActive by viewModel.readerModeActive.collectAsState()

    // Citation detail dialog
    var selectedCitation by remember { mutableStateOf<Citation?>(null) }
    var messageToCategorize by remember { mutableStateOf<ChatMessage?>(null) }

    // Auto-scroll to bottom whenever a new message is added, typing starts, or content streams
    LaunchedEffect(messages.size, isGenerating, messages.lastOrNull()?.content?.length, messages.lastOrNull()?.agentSteps?.size) {
        if (messages.isNotEmpty() || isGenerating) {
            val totalCount = messages.size + if (isGenerating) 1 else 0
            if (totalCount > 0) {
                listState.animateScrollToItem(totalCount - 1)
            }
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            WorkspaceDrawer(
                workspaces = workspaces,
                activeWorkspaceId = activeWorkspaceId,
                threads = threads,
                activeThreadId = activeThreadId,
                onSelectWorkspace = { ws ->
                    viewModel.selectWorkspace(ws)
                    coroutineScope.launch { drawerState.close() }
                },
                onSelectThread = { th ->
                    viewModel.selectThread(th)
                    coroutineScope.launch { drawerState.close() }
                },
                onNewWorkspace = {
                    coroutineScope.launch { drawerState.close() }
                    viewModel.showNewWorkspace.value = true
                },
                onNewThread = {
                    coroutineScope.launch { drawerState.close() }
                    viewModel.showNewThread.value = true
                },
                onDeleteThread = { thId ->
                    viewModel.deleteThread(thId)
                },
                onOpenSettings = {
                    coroutineScope.launch { drawerState.close() }
                    viewModel.showSettings.value = true
                },
                onOpenInstanceConnect = {
                    coroutineScope.launch { drawerState.close() }
                    viewModel.showInstanceConnect.value = true
                },
                onOpenSovereignStorage = {
                    coroutineScope.launch { drawerState.close() }
                    viewModel.showSovereignStorageDialog.value = true
                },
                onOpenGitHubManager = {
                    coroutineScope.launch { drawerState.close() }
                    viewModel.showGitHubManager.value = true
                }
            )
        }
    ) {
        Scaffold(
            topBar = {
                TopBar(
                    activeWorkspace = activeWorkspace,
                    threadTitle = activeThread?.name ?: "Main Thread",
                    selectedModel = selectedModel,
                    onOpenDrawer = { coroutineScope.launch { drawerState.open() } },
                    onOpenModelPicker = { viewModel.showModelPicker.value = true },
                    onOpenWorkspaceSettings = { viewModel.showWorkspaceSettings.value = true },
                    onOpenQuickActions = { viewModel.showQuickActions.value = true },
                    onOpenInstanceConnect = { viewModel.showInstanceConnect.value = true },
                    onOpenSettings = { viewModel.showSettings.value = true },
                    onOpenSovereignStorage = { viewModel.showSovereignStorageDialog.value = true },
                    onOpenGitHubManager = { viewModel.showGitHubManager.value = true },
                    onExportThread = { viewModel.exportThread("markdown") },
                    onClearHistory = { viewModel.clearMessages() },
                    isReaderMode = readerModeActive,
                    onToggleReaderMode = { viewModel.readerModeActive.value = it }
                )
            },
            bottomBar = {
                if (!readerModeActive) {
                    PromptInputBar(
                        queryMode = activeWorkspace?.queryMode ?: com.vukko.model.QueryMode.CHAT,
                        isGenerating = isGenerating,
                        attachments = attachments,
                        onToggleQueryMode = { newMode ->
                            activeWorkspace?.let {
                                viewModel.updateWorkspace(it.copy(queryMode = newMode))
                            }
                        },
                        onAddAttachment = { att -> viewModel.addAttachment(att) },
                        onRemoveAttachment = { id -> viewModel.removeAttachment(id) },
                        onSendMessage = { prompt -> viewModel.sendMessage(prompt) }
                    )
                }
            },
            containerColor = BackgroundDark
        ) { paddingValues ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            ) {
                if (messages.isEmpty()) {
                    // Empty State with Starter Prompts
                    EmptyChatState(
                        workspace = activeWorkspace,
                        onPromptClick = { prompt -> viewModel.sendMessage(prompt) }
                    )
                } else {
                    // Chat Messages List
                    LazyColumn(
                        state = listState,
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(top = 4.dp, bottom = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(messages, key = { it.id }) { msg ->
                            MessageItem(
                                message = msg,
                                onCitationClick = { citation -> selectedCitation = citation },
                                onDeleteMessage = { messageId -> viewModel.deleteMessage(messageId) },
                                onToggleFavorite = { messageId, isFavorite -> viewModel.toggleMessageFavorite(messageId, isFavorite) },
                                onCategorizeMessage = { message -> messageToCategorize = message },
                                isReaderMode = readerModeActive
                            )
                        }

                        // Display 'typing...' animation component when waiting for LLM response
                        if (isGenerating && (messages.lastOrNull()?.sender == com.vukko.model.MessageSender.USER || messages.lastOrNull()?.content?.isBlank() == true)) {
                            item(key = "typing_indicator_item") {
                                TypingIndicator(
                                    modelName = selectedModel.name,
                                    statusText = if (activeWorkspace?.queryMode == com.vukko.model.QueryMode.AGENT) "planning agent steps..." else "thinking..."
                                )
                            }
                        }
                    }
                }

                if (readerModeActive) {
                    ExtendedFloatingActionButton(
                        onClick = { viewModel.readerModeActive.value = false },
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(24.dp),
                        containerColor = SurfaceVariantDark,
                        contentColor = CyanAccent,
                        icon = { Icon(Icons.Outlined.AutoStories, null) },
                        text = { Text("Exit Reader Mode") }
                    )
                }
            }
        }
    }

    // Citation Detail Dialog
    selectedCitation?.let { citation ->
        AlertDialog(
            onDismissRequest = { selectedCitation = null },
            containerColor = SurfaceDark,
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Description, null, tint = CyanAccent, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = citation.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                }
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "Source: ${citation.source}",
                            style = MaterialTheme.typography.labelSmall,
                            color = TextSecondary
                        )
                        Text(
                            text = "Match Relevance: ${(citation.score * 100).toInt()}%",
                            style = MaterialTheme.typography.labelSmall,
                            color = CyanAccent,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(SurfaceCard)
                            .border(1.dp, BorderSubtle, RoundedCornerShape(8.dp))
                            .padding(12.dp)
                    ) {
                        Text(
                            text = citation.snippet,
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextPrimary,
                            lineHeight = 20.sp
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = { selectedCitation = null },
                    colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark)
                ) {
                    Text("Got it", fontWeight = FontWeight.Bold)
                }
            }
        )
    }

    // Model Picker Bottom Sheet
    if (showModelPicker) {
        ModelPickerSheet(
            selectedModel = selectedModel,
            selectedProvider = selectedProvider,
            getApiKey = { prov -> viewModel.preferencesManager.getApiKey(prov) },
            onSaveApiKey = { prov, key -> viewModel.saveApiKey(prov, key) },
            onSelectModel = { model -> viewModel.selectModel(model) },
            onSelectProvider = { prov -> viewModel.selectProvider(prov) },
            onDismiss = { viewModel.showModelPicker.value = false }
        )
    }

    // Workspace Settings Bottom Sheet
    if (showWorkspaceSettings) {
        activeWorkspace?.let { ws ->
            WorkspaceSettingsSheet(
                workspace = ws,
                documents = documents,
                onUpdateWorkspace = { updated -> viewModel.updateWorkspace(updated) },
                onDeleteWorkspace = { id -> viewModel.deleteWorkspace(id) },
                onAddDocument = { name, type, content -> viewModel.addDocument(name, type, content) },
                onDeleteDocument = { id -> viewModel.deleteDocument(id) },
                onDismiss = { viewModel.showWorkspaceSettings.value = false }
            )
        }
    }

    // Quick Actions Dialog
    if (showQuickActions) {
        QuickActionsDialog(
            onExecuteAction = { action, text -> viewModel.executeQuickAction(action, text) },
            onDismiss = { viewModel.showQuickActions.value = false }
        )
    }

    // Instance Connect Bottom Sheet
    if (showInstanceConnect) {
        InstanceConnectSheet(
            initialUrl = viewModel.preferencesManager.instanceUrl,
            initialKey = viewModel.preferencesManager.instanceApiKey,
            onSaveConfig = { url, key -> viewModel.saveInstanceConfig(url, key) },
            onDismiss = { viewModel.showInstanceConnect.value = false }
        )
    }

    // Settings Bottom Sheet
    if (showSettings) {
        SettingsSheet(
            preferencesManager = viewModel.preferencesManager,
            onRescheduleBackup = { viewModel.rescheduleBackup() },
            onDismiss = { viewModel.showSettings.value = false }
        )
    }

    // Create New Workspace Dialog
    if (showNewWorkspace) {
        NewWorkspaceDialog(
            onCreate = { name, desc, prompt, mode -> viewModel.createWorkspace(name, desc, prompt, mode) },
            onDismiss = { viewModel.showNewWorkspace.value = false }
        )
    }

    // Create New Thread Dialog
    if (showNewThread) {
        NewThreadDialog(
            onCreate = { name -> viewModel.createThread(name) },
            onDismiss = { viewModel.showNewThread.value = false }
        )
    }

    // Export Dialog
    if (showExportDialog && exportData != null) {
        ExportDialog(
            exportData = exportData!!,
            onFormatChange = { format -> viewModel.exportThread(format) },
            onDismiss = { viewModel.showExportDialog.value = false }
        )
    }

    // Sovereign Storage & Room Database Dialog
    if (showSovereignStorageDialog) {
        SovereignStorageDialog(
            stats = sovereignStats,
            onDismiss = { viewModel.showSovereignStorageDialog.value = false },
            onExportAll = { viewModel.exportThread("json") },
            onClearCurrentThread = { viewModel.clearMessages() }
        )
    }

    // GitHub Repos, Commits, PRs & Admin Management Sheet
    if (showGitHubManager) {
        GitHubManagerSheet(
            githubToken = viewModel.preferencesManager.githubToken,
            sshKey = viewModel.preferencesManager.githubSshKey,
            repositories = gitHubRepositories,
            pullRequests = gitHubPullRequests,
            commits = gitHubCommits,
            oauthState = gitHubOAuthState,
            onStartDeviceOAuth = { viewModel.startGitHubDeviceOAuthFlow() },
            onPollDeviceToken = { viewModel.pollGitHubDeviceOAuthToken() },
            onSimulateOAuth = { viewModel.simulateGitHubOAuthConnection() },
            onDisconnectOAuth = { viewModel.disconnectGitHubAccount() },
            onSaveToken = { token -> viewModel.saveGitHubToken(token) },
            onSaveSshKey = { key, cb -> viewModel.saveGitHubSshKey(key, cb) },
            onCreateRepo = { name, desc, isPrivate -> viewModel.createGitHubRepository(name, desc, isPrivate) },
            onCommitAndPush = { repo, branch, path, content, msg -> viewModel.commitAndPushGitHub(repo, branch, path, content, msg) },
            onCreatePR = { repo, title, body, head, base -> viewModel.createGitHubPR(repo, title, body, head, base) },
            onIngestRepoToRAG = { repo -> viewModel.ingestGitHubRepoToRAG(repo) },
            onDismiss = { viewModel.showGitHubManager.value = false }
        )
    }

    // Message Tag Selection Dialog
    messageToCategorize?.let { message ->
        TagSelectionDialog(
            initialTags = message.tags,
            onDismiss = { messageToCategorize = null },
            onSave = { tags ->
                viewModel.updateMessageTags(message.id, tags)
                messageToCategorize = null
            }
        )
    }
}

@Composable
fun EmptyChatState(
    workspace: com.vukko.model.Workspace?,
    onPromptClick: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(SurfaceCard)
                .border(1.dp, CyanAccent.copy(alpha = 0.4f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Image(
                painter = painterResource(id = R.drawable.anything_llm_icon),
                contentDescription = "Vukko",
                modifier = Modifier.size(46.dp)
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = workspace?.name ?: "Vukko",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(6.dp))

        Text(
            text = workspace?.description?.ifBlank { "Ask questions, analyze documents, and collaborate privately." }
                ?: "Ask questions, analyze documents, and collaborate privately.",
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 16.dp)
        )

        Spacer(modifier = Modifier.height(28.dp))

        // Suggested Prompt Cards
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            val suggestions = if (workspace?.queryMode == com.vukko.model.QueryMode.AGENT) {
                listOf(
                    "⚡ Research 2026 AI breakthroughs and save an executive report" to Icons.Outlined.Bolt,
                    "⚡ Audit workspace documents, extract requirements, and save spec" to Icons.Outlined.AutoStories,
                    "⚡ Compare on-device LLM architectures and compute throughput benchmarks" to Icons.Outlined.Psychology,
                    "⚡ Search web for latest Kotlin 2.1 features and create guide" to Icons.Outlined.Code
                )
            } else {
                listOf(
                    "⚡ Run multi-step agent: Research industry trends and save report" to Icons.Outlined.Bolt,
                    "Summarize the documents in this workspace" to Icons.Outlined.AutoStories,
                    "Explain the system architecture and benefits of local AI" to Icons.Outlined.Psychology,
                    "Write a Kotlin sample demonstrating clean architecture" to Icons.Outlined.Code
                )
            }

            suggestions.forEach { (prompt, icon) ->
                val isAgent = prompt.startsWith("⚡")
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(SurfaceCard)
                        .border(1.dp, if (isAgent) AmberWarning.copy(alpha = 0.4f) else BorderSubtle, RoundedCornerShape(12.dp))
                        .clickable { onPromptClick(prompt.removePrefix("⚡ ")) }
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = if (isAgent) AmberWarning else CyanAccent,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = prompt,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (isAgent) AmberWarning else TextPrimary,
                        fontWeight = if (isAgent) FontWeight.SemiBold else FontWeight.Medium
                    )
                }
            }

        }
    }
}
