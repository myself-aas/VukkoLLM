package com.vukko.ui.components

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vukko.model.*
import com.vukko.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GitHubManagerSheet(
    githubToken: String,
    sshKey: String = "",
    repositories: List<GitHubRepository>,
    pullRequests: List<GitHubPullRequest>,
    commits: List<GitHubCommit>,
    oauthState: GitHubOAuthState = GitHubOAuthState.Unlinked,
    onStartDeviceOAuth: () -> Unit = {},
    onPollDeviceToken: () -> Unit = {},
    onSimulateOAuth: () -> Unit = {},
    onDisconnectOAuth: () -> Unit = {},
    onSaveToken: (String) -> Unit,
    onSaveSshKey: (String, (Boolean, String) -> Unit) -> Unit = { _, _ -> },
    onCreateRepo: (name: String, desc: String, isPrivate: Boolean) -> Unit,
    onCommitAndPush: (repo: String, branch: String, path: String, content: String, message: String) -> Unit,
    onCreatePR: (repo: String, title: String, body: String, head: String, base: String) -> Unit,
    onIngestRepoToRAG: (GitHubRepository) -> Unit,
    onDismiss: () -> Unit
) {
    var selectedTab by remember { mutableIntStateOf(0) }
    val context = LocalContext.current
    val clipboardManager = androidx.compose.ui.platform.LocalClipboardManager.current
    val coroutineScope = rememberCoroutineScope()

    var tokenInput by remember { mutableStateOf(githubToken) }
    var sshKeyInput by remember { mutableStateOf(sshKey) }
    var isVerifyingToken by remember { mutableStateOf(false) }

    // Create Repo form state
    var newRepoName by remember { mutableStateOf("") }
    var newRepoDesc by remember { mutableStateOf("") }
    var newRepoIsPrivate by remember { mutableStateOf(false) }

    // Commit & Push form state
    var commitRepoName by remember { mutableStateOf(repositories.firstOrNull()?.name ?: "vukko-mobile") }
    var commitBranch by remember { mutableStateOf("main") }
    var commitFilePath by remember { mutableStateOf("app/src/main/java/com.vukko/LocalFeature.kt") }
    var commitContent by remember { mutableStateOf("// Local feature code committed from Vukko Mobile\nclass LocalFeature {\n    fun execute() = println(\"Local execution with data sovereignty\")\n}") }
    var commitMessage by remember { mutableStateOf("feat: Add local feature with Room persistence") }

    // Create PR form state
    var prRepoName by remember { mutableStateOf(repositories.firstOrNull()?.name ?: "vukko-mobile") }
    var prTitle by remember { mutableStateOf("feat(room): Add local database & offline access") }
    var prBody by remember { mutableStateOf("## Summary\n- Adds Room SQLite schema with zero cloud transmission.\n- Integrates offline chat history search.") }
    var prHeadBranch by remember { mutableStateOf("feature/room-database") }
    var prBaseBranch by remember { mutableStateOf("main") }

    // Repo Search
    var repoSearchQuery by remember { mutableStateOf("") }

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
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(SurfaceCard)
                            .border(1.dp, BorderSubtle, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Code,
                            contentDescription = "GitHub",
                            tint = CyanAccent,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            text = "GitHub Operations Suite",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                        Text(
                            text = "Pull, Push, Commit, PRs & OAuth2 Auth",
                            style = MaterialTheme.typography.labelSmall,
                            color = TextSecondary
                        )
                    }
                }

                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier.testTag("close_github_sheet")
                ) {
                    Icon(Icons.Default.Close, contentDescription = "Close", tint = TextSecondary)
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Scrollable Tab Navigation
            ScrollableTabRow(
                selectedTabIndex = selectedTab,
                containerColor = SurfaceCard,
                contentColor = CyanAccent,
                edgePadding = 0.dp,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .border(1.dp, BorderSubtle, RoundedCornerShape(12.dp))
            ) {
                val tabs = listOf(
                    "Repos (${repositories.size})",
                    "New Repo",
                    "Commit & Push",
                    "Pull Requests",
                    "PAT & OAuth2"
                )
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = {
                            Text(
                                text = title,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = if (selectedTab == index) FontWeight.Bold else FontWeight.Medium,
                                color = if (selectedTab == index) CyanAccent else TextSecondary
                            )
                        }
                    )
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // TAB 0: REPOSITORIES LIST & RAG INGESTION
            if (selectedTab == 0) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    OutlinedTextField(
                        value = repoSearchQuery,
                        onValueChange = { repoSearchQuery = it },
                        placeholder = { Text("Search repositories...", style = MaterialTheme.typography.bodySmall, color = TextMuted) },
                        leadingIcon = { Icon(Icons.Default.Search, null, tint = TextSecondary, modifier = Modifier.size(16.dp)) },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.bodySmall.copy(color = TextPrimary),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent,
                            unfocusedBorderColor = BorderSubtle
                        ),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 10.dp)
                    )

                    val filtered = remember(repositories, repoSearchQuery) {
                        if (repoSearchQuery.isBlank()) repositories
                        else repositories.filter { it.name.contains(repoSearchQuery, ignoreCase = true) || it.description.contains(repoSearchQuery, ignoreCase = true) }
                    }

                    LazyColumn(
                        modifier = Modifier.height(340.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(filtered) { repo ->
                            Card(
                                colors = CardDefaults.cardColors(containerColor = SurfaceCard),
                                border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(modifier = Modifier.padding(12.dp)) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Icon(
                                                imageVector = if (repo.isPrivate) Icons.Default.Lock else Icons.Default.Folder,
                                                contentDescription = null,
                                                tint = if (repo.isPrivate) AmberWarning else CyanAccent,
                                                modifier = Modifier.size(18.dp)
                                            )
                                            Spacer(modifier = Modifier.width(8.dp))
                                            Text(
                                                text = repo.fullName,
                                                style = MaterialTheme.typography.titleSmall,
                                                fontWeight = FontWeight.Bold,
                                                color = TextPrimary,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        }

                                        Surface(
                                            color = if (repo.isPrivate) AmberWarning.copy(alpha = 0.15f) else SuccessGreen.copy(alpha = 0.15f),
                                            shape = RoundedCornerShape(4.dp)
                                        ) {
                                            Text(
                                                text = if (repo.isPrivate) "Private" else "Public",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = if (repo.isPrivate) AmberWarning else SuccessGreen,
                                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                            )
                                        }
                                    }

                                    if (repo.description.isNotBlank()) {
                                        Spacer(modifier = Modifier.height(4.dp))
                                        Text(
                                            text = repo.description,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = TextSecondary,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }

                                    Spacer(modifier = Modifier.height(8.dp))

                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                            Text(
                                                text = "⭐ ${repo.starsCount}",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = TextMuted
                                            )
                                            Text(
                                                text = "🍴 ${repo.forksCount}",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = TextMuted
                                            )
                                            Text(
                                                text = "🌿 ${repo.defaultBranch}",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = TextMuted
                                            )
                                        }

                                        Button(
                                            onClick = {
                                                onIngestRepoToRAG(repo)
                                                Toast.makeText(context, "Ingested ${repo.name} into Workspace Knowledge Base!", Toast.LENGTH_LONG).show()
                                            },
                                            colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark),
                                            shape = RoundedCornerShape(6.dp),
                                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                                            modifier = Modifier.height(28.dp)
                                        ) {
                                            Icon(Icons.Default.CloudDownload, contentDescription = null, modifier = Modifier.size(14.dp))
                                            Spacer(modifier = Modifier.width(4.dp))
                                            Text("Ingest into RAG", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // TAB 1: CREATE NEW GITHUB REPOSITORY
            if (selectedTab == 1) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 360.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "CREATE GITHUB REPOSITORY",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = TextMuted,
                        letterSpacing = 1.sp
                    )

                    OutlinedTextField(
                        value = newRepoName,
                        onValueChange = { newRepoName = it },
                        label = { Text("Repository Name") },
                        placeholder = { Text("e.g. android-agent-tools") },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                        )
                    )

                    OutlinedTextField(
                        value = newRepoDesc,
                        onValueChange = { newRepoDesc = it },
                        label = { Text("Description (Optional)") },
                        placeholder = { Text("Brief description of repository purpose...") },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                        )
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Make Private Repository", style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
                        Switch(
                            checked = newRepoIsPrivate,
                            onCheckedChange = { newRepoIsPrivate = it },
                            colors = SwitchDefaults.colors(checkedThumbColor = BackgroundDark, checkedTrackColor = AmberWarning)
                        )
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    Button(
                        onClick = {
                            if (newRepoName.isNotBlank()) {
                                onCreateRepo(newRepoName.trim(), newRepoDesc.trim(), newRepoIsPrivate)
                                Toast.makeText(context, "Repository '${newRepoName}' created successfully!", Toast.LENGTH_SHORT).show()
                                newRepoName = ""
                                newRepoDesc = ""
                                selectedTab = 0
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp)
                            .testTag("create_github_repo_submit_btn")
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Create Repository on GitHub", fontWeight = FontWeight.Bold)
                    }
                }
            }

            // TAB 2: COMMIT & PUSH
            if (selectedTab == 2) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 360.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "COMMIT & PUSH CODE TO GITHUB",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = TextMuted,
                        letterSpacing = 1.sp
                    )

                    OutlinedTextField(
                        value = commitRepoName,
                        onValueChange = { commitRepoName = it },
                        label = { Text("Target Repository") },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                        )
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = commitBranch,
                            onValueChange = { commitBranch = it },
                            label = { Text("Branch") },
                            modifier = Modifier.weight(1f),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                                focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                            )
                        )
                        OutlinedTextField(
                            value = commitFilePath,
                            onValueChange = { commitFilePath = it },
                            label = { Text("File Path") },
                            modifier = Modifier.weight(2f),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                                focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                            )
                        )
                    }

                    OutlinedTextField(
                        value = commitMessage,
                        onValueChange = { commitMessage = it },
                        label = { Text("Commit Message") },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                        )
                    )

                    OutlinedTextField(
                        value = commitContent,
                        onValueChange = { commitContent = it },
                        label = { Text("File Content") },
                        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(110.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                        )
                    )

                    Button(
                        onClick = {
                            if (commitRepoName.isNotBlank() && commitMessage.isNotBlank()) {
                                onCommitAndPush(commitRepoName, commitBranch, commitFilePath, commitContent, commitMessage)
                                Toast.makeText(context, "Pushed commit to GitHub branch '${commitBranch}'!", Toast.LENGTH_SHORT).show()
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(46.dp)
                            .testTag("push_commit_btn")
                    ) {
                        Icon(Icons.Default.Publish, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Commit & Push to GitHub", fontWeight = FontWeight.Bold)
                    }
                }
            }

            // TAB 3: PULL REQUESTS
            if (selectedTab == 3) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 360.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "CREATE PULL REQUEST",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = TextMuted,
                        letterSpacing = 1.sp
                    )

                    OutlinedTextField(
                        value = prTitle,
                        onValueChange = { prTitle = it },
                        label = { Text("PR Title") },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                        )
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = prHeadBranch,
                            onValueChange = { prHeadBranch = it },
                            label = { Text("Head Branch") },
                            modifier = Modifier.weight(1f),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                                focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                            )
                        )
                        OutlinedTextField(
                            value = prBaseBranch,
                            onValueChange = { prBaseBranch = it },
                            label = { Text("Base Branch") },
                            modifier = Modifier.weight(1f),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                                focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                            )
                        )
                    }

                    OutlinedTextField(
                        value = prBody,
                        onValueChange = { prBody = it },
                        label = { Text("PR Description") },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(90.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                        )
                    )

                    Button(
                        onClick = {
                            if (prTitle.isNotBlank()) {
                                onCreatePR(prRepoName, prTitle, prBody, prHeadBranch, prBaseBranch)
                                Toast.makeText(context, "Pull Request created successfully!", Toast.LENGTH_SHORT).show()
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = AnythingPurple, contentColor = TextPrimary),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(46.dp)
                            .testTag("create_pr_btn")
                    ) {
                        Icon(Icons.Default.MergeType, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Create Pull Request", fontWeight = FontWeight.Bold)
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    Text(
                        text = "OPEN PULL REQUESTS",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = TextMuted,
                        letterSpacing = 1.sp
                    )

                    pullRequests.forEach { pr ->
                        Card(
                            colors = CardDefaults.cardColors(containerColor = SurfaceCard),
                            border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(10.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = "#${pr.number} ${pr.title}",
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = TextPrimary
                                    )
                                    Surface(
                                        color = if (pr.state == PRState.OPEN) SuccessGreen.copy(alpha = 0.15f) else AnythingPurple.copy(alpha = 0.15f),
                                        shape = RoundedCornerShape(4.dp)
                                    ) {
                                        Text(
                                            text = pr.state.name,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = if (pr.state == PRState.OPEN) SuccessGreen else AnythingPurple,
                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                        )
                                    }
                                }
                                Text(
                                    text = "${pr.headBranch} -> ${pr.baseBranch} • by ${pr.author}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = TextMuted
                                )
                            }
                        }
                    }
                }
            }

            // TAB 4: PAT & OAUTH2 AUTHENTICATION
            if (selectedTab == 4) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 380.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // ACCOUNT CONNECTION STATUS
                    if (oauthState is GitHubOAuthState.Connected || githubToken.isNotBlank()) {
                        val username = if (oauthState is GitHubOAuthState.Connected) oauthState.userProfile.login else "Linked User"
                        Card(
                            colors = CardDefaults.cardColors(containerColor = SurfaceCard),
                            border = androidx.compose.foundation.BorderStroke(1.dp, SuccessGreen),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier = Modifier
                                                .size(32.dp)
                                                .clip(CircleShape)
                                                .background(SuccessGreen.copy(alpha = 0.2f)),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = SuccessGreen, modifier = Modifier.size(20.dp))
                                        }
                                        Spacer(modifier = Modifier.width(10.dp))
                                        Column {
                                            Text(
                                                text = "@$username",
                                                style = MaterialTheme.typography.titleSmall,
                                                fontWeight = FontWeight.Bold,
                                                color = TextPrimary
                                            )
                                            Text(
                                                text = "GitHub OAuth2 Linked & Authorized",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = SuccessGreen
                                            )
                                        }
                                    }

                                    Surface(
                                        color = SuccessGreen.copy(alpha = 0.15f),
                                        shape = RoundedCornerShape(6.dp)
                                    ) {
                                        Text(
                                            text = "OAuth Active",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = SuccessGreen,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                    }
                                }

                                Spacer(modifier = Modifier.height(10.dp))

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = "Scopes: repo, user, workflow",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = TextMuted,
                                        fontFamily = FontFamily.Monospace
                                    )

                                    OutlinedButton(
                                        onClick = {
                                            onDisconnectOAuth()
                                            tokenInput = ""
                                            Toast.makeText(context, "GitHub Account Unlinked", Toast.LENGTH_SHORT).show()
                                        },
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = AmberWarning),
                                        border = androidx.compose.foundation.BorderStroke(1.dp, AmberWarning.copy(alpha = 0.5f)),
                                        shape = RoundedCornerShape(6.dp),
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                                        modifier = Modifier.height(28.dp)
                                    ) {
                                        Text("Unlink Account", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                    }
                                }
                            }
                        }
                    }

                    // OAUTH2 DEVICE CODE FLOW SECTION
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfaceCard),
                        border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.VpnKey, contentDescription = null, tint = CyanAccent, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "GitHub OAuth2 Device Authorization",
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = TextPrimary
                                )
                            }

                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = "Link your account securely without pasting tokens using GitHub's official 8-character device verification code flow.",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextSecondary,
                                fontSize = 11.sp
                            )

                            Spacer(modifier = Modifier.height(12.dp))

                            when (oauthState) {
                                is GitHubOAuthState.CodeReceived -> {
                                    val codeResp = oauthState.deviceCodeResponse
                                    Column(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(BackgroundDark)
                                            .border(1.dp, CyanAccent, RoundedCornerShape(8.dp))
                                            .padding(12.dp),
                                        horizontalAlignment = Alignment.CenterHorizontally
                                    ) {
                                        Text(
                                            text = "YOUR DEVICE VERIFICATION CODE",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = TextMuted,
                                            fontWeight = FontWeight.Bold
                                        )

                                        Spacer(modifier = Modifier.height(6.dp))

                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.Center
                                        ) {
                                            Text(
                                                text = codeResp.userCode,
                                                fontSize = 24.sp,
                                                fontWeight = FontWeight.Bold,
                                                fontFamily = FontFamily.Monospace,
                                                color = CyanAccent,
                                                letterSpacing = 2.sp
                                            )
                                            Spacer(modifier = Modifier.width(10.dp))
                                            IconButton(
                                                onClick = {
                                                    clipboardManager.setText(androidx.compose.ui.text.AnnotatedString(codeResp.userCode))
                                                    Toast.makeText(context, "User code '${codeResp.userCode}' copied!", Toast.LENGTH_SHORT).show()
                                                },
                                                modifier = Modifier.size(28.dp)
                                            ) {
                                                Icon(Icons.Default.ContentCopy, contentDescription = "Copy Code", tint = CyanAccent, modifier = Modifier.size(18.dp))
                                            }
                                        }

                                        Spacer(modifier = Modifier.height(6.dp))
                                        Text(
                                            text = "1. Copy code  2. Visit github.com/login/device  3. Click Verify",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = TextSecondary,
                                            fontSize = 11.sp
                                        )

                                        Spacer(modifier = Modifier.height(10.dp))

                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Button(
                                                onClick = { onPollDeviceToken() },
                                                colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark),
                                                shape = RoundedCornerShape(8.dp),
                                                modifier = Modifier.weight(1f).height(38.dp)
                                            ) {
                                                Text("Verify & Complete", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                            }

                                            Button(
                                                onClick = { onSimulateOAuth() },
                                                colors = ButtonDefaults.buttonColors(containerColor = AnythingPurple, contentColor = TextPrimary),
                                                shape = RoundedCornerShape(8.dp),
                                                modifier = Modifier.weight(1f).height(38.dp)
                                            ) {
                                                Text("Authorize Demo", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                            }
                                        }
                                    }
                                }

                                is GitHubOAuthState.RequestingCode, is GitHubOAuthState.PollingToken -> {
                                    Row(
                                        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                                        horizontalArrangement = Arrangement.Center,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        CircularProgressIndicator(modifier = Modifier.size(20.dp), color = CyanAccent, strokeWidth = 2.dp)
                                        Spacer(modifier = Modifier.width(10.dp))
                                        Text("Communicating with GitHub OAuth Services...", style = MaterialTheme.typography.bodySmall, color = CyanAccent)
                                    }
                                }

                                else -> {
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Button(
                                            onClick = { onStartDeviceOAuth() },
                                            colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark),
                                            shape = RoundedCornerShape(8.dp),
                                            modifier = Modifier.weight(1f).height(42.dp).testTag("start_github_oauth_btn")
                                        ) {
                                            Icon(Icons.Default.LockOpen, contentDescription = null, modifier = Modifier.size(16.dp))
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text("Connect GitHub OAuth2", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                        }

                                        Button(
                                            onClick = { onSimulateOAuth() },
                                            colors = ButtonDefaults.buttonColors(containerColor = SurfaceCard, contentColor = TextPrimary),
                                            border = androidx.compose.foundation.BorderStroke(1.dp, BorderSubtle),
                                            shape = RoundedCornerShape(8.dp),
                                            modifier = Modifier.height(42.dp)
                                        ) {
                                            Text("Instant Link", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // MANUAL PERSONAL ACCESS TOKEN SECTION
                    Text(
                        text = "MANUAL PERSONAL ACCESS TOKEN (PAT)",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = TextMuted,
                        letterSpacing = 1.sp
                    )

                    OutlinedTextField(
                        value = tokenInput,
                        onValueChange = { tokenInput = it },
                        label = { Text("Personal Access Token (PAT)") },
                        placeholder = { Text("ghp_xxxxxxxxxxxx") },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                        )
                    )

                    Button(
                        onClick = {
                            onSaveToken(tokenInput.trim())
                            Toast.makeText(context, "GitHub Token Saved!", Toast.LENGTH_SHORT).show()
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = CyanAccent, contentColor = BackgroundDark),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(44.dp)
                            .testTag("save_github_token_btn")
                    ) {
                        Icon(Icons.Default.Save, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Save Token", fontWeight = FontWeight.Bold)
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    Text(
                        text = "SSH AUTHENTICATION (RSA / ED25519)",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = TextMuted,
                        letterSpacing = 1.sp
                    )

                    OutlinedTextField(
                        value = sshKeyInput,
                        onValueChange = { sshKeyInput = it },
                        label = { Text("SSH Private Key (PEM / OpenSSH)") },
                        placeholder = { Text("-----BEGIN OPENSSH PRIVATE KEY-----...") },
                        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(110.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                            focusedBorderColor = CyanAccent, unfocusedBorderColor = BorderSubtle
                        )
                    )

                    Button(
                        onClick = {
                            if (sshKeyInput.isNotBlank()) {
                                onSaveSshKey(sshKeyInput.trim()) { success, msg ->
                                    Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                                }
                            } else {
                                Toast.makeText(context, "Please enter a valid SSH private key", Toast.LENGTH_SHORT).show()
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = AnythingPurple, contentColor = TextPrimary),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(44.dp)
                            .testTag("save_github_ssh_btn")
                    ) {
                        Icon(Icons.Default.VpnKey, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Verify & Save SSH Key", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
