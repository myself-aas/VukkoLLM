package com.vukko.model

enum class QueryMode {
    CHAT,   // Standard conversational mode using workspace prompt and context
    QUERY,  // Strict RAG mode: answers ONLY using embedded knowledge base documents
    AGENT   // Autonomous Agent: multi-step planning, iterative tool execution and document creation
}

data class Workspace(
    val id: String,
    val name: String,
    val slug: String,
    val description: String = "",
    val systemPrompt: String = "You are a helpful, versatile AI assistant powered by Vukko. Answer clearly, provide reasoning when complex, and cite sources when referencing documents.",
    val temperature: Float = 0.7f,
    val queryMode: QueryMode = QueryMode.CHAT,
    val vectorCount: Int = 0,
    val documentCount: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val agentMaxSteps: Int = 5,
    val agentAllowWebSearch: Boolean = true,
    val agentAllowFileCreation: Boolean = true,
    val agentAllowDocumentSearch: Boolean = true
)

data class WorkspaceThread(
    val id: String,
    val workspaceId: String,
    val name: String,
    val slug: String,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val messageCount: Int = 0,
    val lastMessageSnippet: String? = null,
    val isPinned: Boolean = false
)

