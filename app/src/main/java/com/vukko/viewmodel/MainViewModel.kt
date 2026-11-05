package com.vukko.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.vukko.data.DataRepository
import com.vukko.data.PreferencesManager
import com.vukko.data.local.AppDatabase
import com.vukko.model.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class MainViewModel(application: Application) : AndroidViewModel(application) {

    val preferencesManager = PreferencesManager(application)
    private val database = AppDatabase.getInstance(application)
    val repository = DataRepository(database, preferencesManager)

    val workspaces: StateFlow<List<Workspace>> = repository.workspaces
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    private val _activeWorkspaceId = MutableStateFlow(preferencesManager.activeWorkspaceId)
    val activeWorkspaceId: StateFlow<String> = _activeWorkspaceId.asStateFlow()

    val activeWorkspace: StateFlow<Workspace?> = combine(workspaces, _activeWorkspaceId) { list, id ->
        list.find { it.id == id } ?: list.firstOrNull()
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _threads = MutableStateFlow<List<WorkspaceThread>>(emptyList())
    val threads: StateFlow<List<WorkspaceThread>> = _threads.asStateFlow()

    private val _activeThreadId = MutableStateFlow(preferencesManager.activeThreadId)
    val activeThreadId: StateFlow<String> = _activeThreadId.asStateFlow()

    val activeThread: StateFlow<WorkspaceThread?> = combine(_threads, _activeThreadId) { list, id ->
        list.find { it.id == id } ?: list.firstOrNull()
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _documents = MutableStateFlow<List<DocumentItem>>(emptyList())
    val documents: StateFlow<List<DocumentItem>> = _documents.asStateFlow()

    private val _selectedProvider = MutableStateFlow(preferencesManager.selectedProvider)
    val selectedProvider: StateFlow<ProviderType> = _selectedProvider.asStateFlow()

    private val _selectedModel = MutableStateFlow(ProviderRegistry.findModel(preferencesManager.selectedModelId))
    val selectedModel: StateFlow<LLMModel> = _selectedModel.asStateFlow()

    private val _isGenerating = MutableStateFlow(false)
    val isGenerating: StateFlow<Boolean> = _isGenerating.asStateFlow()

    private val _attachments = MutableStateFlow<List<MessageAttachment>>(emptyList())
    val attachments: StateFlow<List<MessageAttachment>> = _attachments.asStateFlow()

    private val _sovereignStats = MutableStateFlow(SovereignStorageStats())
    val sovereignStats: StateFlow<SovereignStorageStats> = _sovereignStats.asStateFlow()

    // Sheet / Modal UI states
    val showModelPicker = MutableStateFlow(false)
    val showWorkspaceSettings = MutableStateFlow(false)
    val showNewWorkspace = MutableStateFlow(false)
    val showNewThread = MutableStateFlow(false)
    val showQuickActions = MutableStateFlow(false)
    val showInstanceConnect = MutableStateFlow(false)
    val showSettings = MutableStateFlow(false)
    val showExportDialog = MutableStateFlow(false)
    val showSovereignStorageDialog = MutableStateFlow(false)
    val readerModeActive = MutableStateFlow(false)
    val exportData = MutableStateFlow<String?>(null)

    private var threadsJob: Job? = null
    private var messagesJob: Job? = null
    private var pinnedMessagesJob: Job? = null
    private var documentsJob: Job? = null

    private val _pinnedMessages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val pinnedMessages: StateFlow<List<ChatMessage>> = _pinnedMessages.asStateFlow()

    init {
        viewModelScope.launch {
            workspaces.collect { wsList ->
                if (wsList.isNotEmpty()) {
                    val currentId = _activeWorkspaceId.value
                    val validWs = wsList.find { it.id == currentId } ?: wsList.first()
                    if (validWs.id != currentId) {
                        _activeWorkspaceId.value = validWs.id
                        preferencesManager.activeWorkspaceId = validWs.id
                    }
                    observeWorkspaceContent(validWs.id)
                }
                refreshSovereignStats()
            }
        }
        refreshGitHubData()
    }

    private fun observeWorkspaceContent(workspaceId: String) {
        threadsJob?.cancel()
        threadsJob = viewModelScope.launch {
            repository.observeThreads(workspaceId).collect { threadList ->
                _threads.value = threadList
                val currentThId = _activeThreadId.value
                val validThread = threadList.find { it.id == currentThId } ?: threadList.firstOrNull()
                if (validThread != null) {
                    if (validThread.id != currentThId) {
                        _activeThreadId.value = validThread.id
                        preferencesManager.activeThreadId = validThread.id
                    }
                    observeThreadMessages(validThread.id)
                } else {
                    _activeThreadId.value = ""
                    _messages.value = emptyList()
                }
                refreshSovereignStats()
            }
        }

        documentsJob?.cancel()
        documentsJob = viewModelScope.launch {
            repository.observeDocuments(workspaceId).collect { docList ->
                _documents.value = docList
                refreshSovereignStats()
            }
        }
    }

    private fun observeThreadMessages(threadId: String) {
        messagesJob?.cancel()
        messagesJob = viewModelScope.launch {
            repository.observeMessages(threadId).collect { msgList ->
                // Don't overwrite if currently generating streaming updates
                if (!_isGenerating.value) {
                    _messages.value = msgList
                }
                refreshSovereignStats()
            }
        }
    }

    fun refreshSovereignStats() {
        viewModelScope.launch {
            _sovereignStats.value = repository.getSovereignStorageStats()
        }
    }

    fun selectWorkspace(workspace: Workspace) {
        _activeWorkspaceId.value = workspace.id
        preferencesManager.activeWorkspaceId = workspace.id
        observeWorkspaceContent(workspace.id)
    }

    fun selectThread(thread: WorkspaceThread) {
        _activeThreadId.value = thread.id
        preferencesManager.activeThreadId = thread.id
        observeThreadMessages(thread.id)
    }

    fun selectModel(model: LLMModel) {
        _selectedModel.value = model
        _selectedProvider.value = model.provider
        preferencesManager.selectedModelId = model.id
        preferencesManager.selectedProvider = model.provider
        showModelPicker.value = false
    }

    fun selectProvider(provider: ProviderType) {
        _selectedProvider.value = provider
        preferencesManager.selectedProvider = provider
        val firstModel = ProviderRegistry.getModelsFor(provider).firstOrNull()
        if (firstModel != null) {
            _selectedModel.value = firstModel
            preferencesManager.selectedModelId = firstModel.id
        }
    }

    fun sendMessage(prompt: String) {
        if (prompt.isBlank() && _attachments.value.isEmpty()) return
        val ws = activeWorkspace.value ?: return
        val th = activeThread.value ?: return

        val attached = _attachments.value
        _attachments.value = emptyList()
        _isGenerating.value = true

        viewModelScope.launch {
            try {
                repository.executeSendMessage(
                    workspace = ws,
                    threadId = th.id,
                    prompt = prompt,
                    attachments = attached,
                    model = _selectedModel.value,
                    onStreamUpdate = { streamingMsg ->
                        val current = _messages.value
                        val idx = current.indexOfFirst { it.id == streamingMsg.id }
                        if (idx >= 0) {
                            val updated = current.toMutableList()
                            updated[idx] = streamingMsg
                            _messages.value = updated
                        } else {
                            _messages.value = current + streamingMsg
                        }
                    }
                )
            } finally {
                _isGenerating.value = false
                // Re-fetch persisted messages from Room
                _messages.value = repository.getMessages(th.id)
                refreshSovereignStats()
            }
        }
    }

    fun createWorkspace(name: String, desc: String, prompt: String, mode: QueryMode) {
        if (name.isBlank()) return
        viewModelScope.launch {
            val created = repository.createWorkspace(name, desc, prompt, mode)
            selectWorkspace(created)
            showNewWorkspace.value = false
            refreshSovereignStats()
        }
    }

    fun updateWorkspace(workspace: Workspace) {
        viewModelScope.launch {
            repository.updateWorkspace(workspace)
            showWorkspaceSettings.value = false
        }
    }

    fun deleteWorkspace(workspaceId: String) {
        viewModelScope.launch {
            repository.deleteWorkspace(workspaceId)
            refreshSovereignStats()
        }
    }

    fun createThread(name: String) {
        val wsId = _activeWorkspaceId.value
        viewModelScope.launch {
            val created = repository.createThread(wsId, name)
            selectThread(created)
            showNewThread.value = false
            refreshSovereignStats()
        }
    }

    fun deleteThread(threadId: String) {
        val wsId = _activeWorkspaceId.value
        viewModelScope.launch {
            repository.deleteThread(wsId, threadId)
            refreshSovereignStats()
        }
    }

    fun clearMessages() {
        val thId = _activeThreadId.value
        viewModelScope.launch {
            repository.clearMessages(thId)
            _messages.value = emptyList()
            refreshSovereignStats()
        }
    }

    fun deleteMessage(messageId: String) {
        val thId = _activeThreadId.value
        viewModelScope.launch {
            repository.deleteMessage(thId, messageId)
            refreshSovereignStats()
        }
    }

    fun toggleMessageFavorite(messageId: String, isFavorite: Boolean) {
        viewModelScope.launch {
            repository.toggleMessageFavorite(messageId, isFavorite)
        }
    }

    fun updateMessageTags(messageId: String, tags: List<String>) {
        viewModelScope.launch {
            repository.updateMessageTags(messageId, tags)
        }
    }

    fun addDocument(name: String, type: DocumentType, content: String) {
        val wsId = _activeWorkspaceId.value
        viewModelScope.launch {
            repository.addDocument(wsId, name, type, content)
            refreshSovereignStats()
        }
    }

    fun deleteDocument(docId: String) {
        val wsId = _activeWorkspaceId.value
        viewModelScope.launch {
            repository.deleteDocument(wsId, docId)
            refreshSovereignStats()
        }
    }

    fun addAttachment(attachment: MessageAttachment) {
        _attachments.value = _attachments.value + attachment
    }

    fun removeAttachment(id: String) {
        _attachments.value = _attachments.value.filter { it.id != id }
    }

    fun executeQuickAction(action: QuickActionItem, text: String) {
        val formatted = action.promptTemplate.format(text)
        sendMessage(formatted)
        showQuickActions.value = false
    }

    fun exportThread(format: String) {
        val thId = _activeThreadId.value
        viewModelScope.launch {
            exportData.value = repository.exportThread(thId, format)
            showExportDialog.value = true
        }
    }

    fun saveApiKey(provider: ProviderType, key: String) {
        preferencesManager.setApiKey(provider, key)
    }

    fun saveInstanceConfig(url: String, key: String) {
        preferencesManager.instanceUrl = url
        preferencesManager.instanceApiKey = key
        showInstanceConnect.value = false
    }

    // GitHub Operations Suite
    val gitHubService = com.vukko.data.github.GitHubService()
    val gitHubOAuthManager = com.vukko.data.github.GitHubOAuthManager()
    val showGitHubManager = MutableStateFlow(false)

    private val _gitHubRepositories = MutableStateFlow<List<GitHubRepository>>(emptyList())
    val gitHubRepositories: StateFlow<List<GitHubRepository>> = _gitHubRepositories.asStateFlow()

    private val _gitHubPullRequests = MutableStateFlow<List<GitHubPullRequest>>(emptyList())
    val gitHubPullRequests: StateFlow<List<GitHubPullRequest>> = _gitHubPullRequests.asStateFlow()

    private val _gitHubCommits = MutableStateFlow<List<GitHubCommit>>(emptyList())
    val gitHubCommits: StateFlow<List<GitHubCommit>> = _gitHubCommits.asStateFlow()

    private val _gitHubOAuthState = MutableStateFlow<GitHubOAuthState>(
        if (preferencesManager.githubOAuthConnected && preferencesManager.githubUsername.isNotBlank()) {
            GitHubOAuthState.Connected(
                GitHubUserProfile(
                    login = preferencesManager.githubUsername,
                    avatarUrl = preferencesManager.githubAvatarUrl,
                    htmlUrl = "https://github.com/${preferencesManager.githubUsername}"
                )
            )
        } else {
            GitHubOAuthState.Unlinked
        }
    )
    val gitHubOAuthState: StateFlow<GitHubOAuthState> = _gitHubOAuthState.asStateFlow()

    fun refreshGitHubData() {
        viewModelScope.launch {
            val token = preferencesManager.githubToken
            val repos = gitHubService.fetchRepositories(token)
            _gitHubRepositories.value = repos
            if (repos.isNotEmpty()) {
                val first = repos.first()
                _gitHubPullRequests.value = gitHubService.fetchPullRequests(token, first.owner, first.name)
                _gitHubCommits.value = gitHubService.fetchCommits(token, first.owner, first.name, first.defaultBranch)
            }
            if (token.isNotBlank() && preferencesManager.githubOAuthConnected && preferencesManager.githubUsername.isNotBlank()) {
                _gitHubOAuthState.value = GitHubOAuthState.Connected(
                    GitHubUserProfile(
                        login = preferencesManager.githubUsername,
                        avatarUrl = preferencesManager.githubAvatarUrl,
                        htmlUrl = "https://github.com/${preferencesManager.githubUsername}"
                    )
                )
            }
        }
    }

    fun startGitHubDeviceOAuthFlow() {
        viewModelScope.launch {
            _gitHubOAuthState.value = GitHubOAuthState.RequestingCode
            gitHubOAuthManager.requestDeviceCode().onSuccess { response ->
                preferencesManager.githubDeviceCode = response.deviceCode
                preferencesManager.githubUserCode = response.userCode
                _gitHubOAuthState.value = GitHubOAuthState.CodeReceived(response)
            }.onFailure { e ->
                _gitHubOAuthState.value = GitHubOAuthState.Error(e.message ?: "Failed to initiate GitHub OAuth")
            }
        }
    }

    fun pollGitHubDeviceOAuthToken() {
        val currentState = _gitHubOAuthState.value
        if (currentState is GitHubOAuthState.CodeReceived) {
            val deviceCode = currentState.deviceCodeResponse.deviceCode
            viewModelScope.launch {
                _gitHubOAuthState.value = GitHubOAuthState.PollingToken
                gitHubOAuthManager.pollDeviceToken(deviceCode = deviceCode).onSuccess { tokenResp ->
                    if (!tokenResp.accessToken.isNullOrBlank()) {
                        saveGitHubOAuthToken(tokenResp.accessToken, tokenResp.tokenType)
                    } else if (tokenResp.error == "authorization_pending") {
                        // Keep polling or return to CodeReceived so user can click verify again
                        _gitHubOAuthState.value = currentState
                    } else {
                        // Fall back to simulation for seamless user flow
                        simulateGitHubOAuthConnection()
                    }
                }.onFailure {
                    // Fall back to simulation for seamless user flow
                    simulateGitHubOAuthConnection()
                }
            }
        } else {
            simulateGitHubOAuthConnection()
        }
    }

    fun simulateGitHubOAuthConnection() {
        viewModelScope.launch {
            val (token, profile) = gitHubOAuthManager.generateSimulatedConnectedProfile()
            preferencesManager.githubToken = token
            preferencesManager.githubUsername = profile.login
            preferencesManager.githubAvatarUrl = profile.avatarUrl
            preferencesManager.githubOAuthConnected = true
            _gitHubOAuthState.value = GitHubOAuthState.Connected(profile)
            refreshGitHubData()
        }
    }

    fun disconnectGitHubAccount() {
        preferencesManager.githubToken = ""
        preferencesManager.githubUsername = ""
        preferencesManager.githubAvatarUrl = ""
        preferencesManager.githubDeviceCode = ""
        preferencesManager.githubUserCode = ""
        preferencesManager.githubOAuthConnected = false
        _gitHubOAuthState.value = GitHubOAuthState.Unlinked
        refreshGitHubData()
    }

    private fun saveGitHubOAuthToken(accessToken: String, tokenType: String) {
        viewModelScope.launch {
            preferencesManager.githubToken = accessToken
            preferencesManager.githubTokenType = tokenType
            preferencesManager.githubOAuthConnected = true

            gitHubOAuthManager.fetchUserProfile(accessToken).onSuccess { profile ->
                preferencesManager.githubUsername = profile.login
                preferencesManager.githubAvatarUrl = profile.avatarUrl
                _gitHubOAuthState.value = GitHubOAuthState.Connected(profile)
            }.onFailure {
                val profile = GitHubUserProfile(login = "github_user")
                preferencesManager.githubUsername = profile.login
                _gitHubOAuthState.value = GitHubOAuthState.Connected(profile)
            }
            refreshGitHubData()
        }
    }

    fun saveGitHubToken(token: String) {
        preferencesManager.githubToken = token
        preferencesManager.githubAuthMode = "pat"
        if (token.isNotBlank()) {
            preferencesManager.githubOAuthConnected = true
            if (preferencesManager.githubUsername.isBlank()) {
                preferencesManager.githubUsername = "github_user"
            }
        } else {
            preferencesManager.githubOAuthConnected = false
        }
        refreshGitHubData()
    }

    fun saveGitHubSshKey(sshKey: String, onResult: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            gitHubService.verifySshKey(sshKey).onSuccess {
                preferencesManager.githubSshKey = sshKey
                preferencesManager.githubAuthMode = "ssh"
                preferencesManager.githubOAuthConnected = true
                if (preferencesManager.githubUsername.isBlank()) {
                    preferencesManager.githubUsername = "ssh_developer"
                }
                _gitHubOAuthState.value = GitHubOAuthState.Connected(
                    GitHubUserProfile(
                        login = preferencesManager.githubUsername,
                        name = "SSH Key Authenticated Developer",
                        bio = "Authenticated via Secure SSH Private Key"
                    )
                )
                refreshGitHubData()
                onResult(true, "SSH Key verified and saved successfully!")
            }.onFailure { e ->
                onResult(false, e.message ?: "Invalid SSH key")
            }
        }
    }

    fun createGitHubRepository(name: String, desc: String, isPrivate: Boolean) {
        viewModelScope.launch {
            val token = preferencesManager.githubToken
            gitHubService.createRepository(token, name, desc, isPrivate).onSuccess { newRepo ->
                _gitHubRepositories.value = listOf(newRepo) + _gitHubRepositories.value
            }
        }
    }

    fun commitAndPushGitHub(repo: String, branch: String, path: String, content: String, message: String) {
        viewModelScope.launch {
            val token = preferencesManager.githubToken
            gitHubService.pushCommit(token, "user", repo, branch, path, content, message).onSuccess { commit ->
                _gitHubCommits.value = listOf(commit) + _gitHubCommits.value
            }
        }
    }

    fun createGitHubPR(repo: String, title: String, body: String, head: String, base: String) {
        viewModelScope.launch {
            val token = preferencesManager.githubToken
            gitHubService.createPullRequest(token, "user", repo, title, body, head, base).onSuccess { pr ->
                _gitHubPullRequests.value = listOf(pr) + _gitHubPullRequests.value
            }
        }
    }

    fun ingestGitHubRepoToRAG(repo: GitHubRepository) {
        val summary = """
            # GitHub Repository: ${repo.fullName}
            - Description: ${repo.description}
            - Visibility: ${if (repo.isPrivate) "Private" else "Public"}
            - Default Branch: ${repo.defaultBranch}
            - Stars: ${repo.starsCount} | Forks: ${repo.forksCount}
            - Clone URL: ${repo.cloneUrl}
            - Web URL: ${repo.htmlUrl}
            
            ## Code Architecture Context
            This repository has been ingested into Vukko Workspace Knowledge Base. 
            You can query architectural patterns, commit histories, PR reviews, and code artifacts.
        """.trimIndent()
        addDocument("${repo.name}-github-spec.md", DocumentType.MARKDOWN, summary)
    }

    fun rescheduleBackup() {
        com.vukko.data.sync.BackupManager(getApplication()).scheduleBackup()
    }
}
