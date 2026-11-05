package com.vukko.model

import kotlinx.serialization.Serializable

@Serializable
enum class MessageSender {
    USER,
    ASSISTANT,
    SYSTEM
}

@Serializable
data class Citation(
    val title: String,
    val source: String,
    val snippet: String,
    val score: Float = 0.88f
)

@Serializable
data class ToolCall(
    val toolName: String,
    val description: String,
    val input: String,
    val output: String,
    val isSuccess: Boolean = true
)

@Serializable
data class MessageAttachment(
    val id: String,
    val name: String,
    val mimeType: String,
    val sizeDisplay: String,
    val previewText: String? = null
)

@Serializable
enum class AgentStepStatus {
    PENDING,
    RUNNING,
    COMPLETED,
    FAILED
}

@Serializable
data class AgentStep(
    val stepIndex: Int,
    val title: String,
    val description: String,
    val toolName: String,
    val status: AgentStepStatus = AgentStepStatus.PENDING,
    val toolInput: String? = null,
    val toolOutput: String? = null,
    val executionTimeMs: Long? = null
)

@Serializable
data class ChatMessage(
    val id: String,
    val threadId: String,
    val sender: MessageSender,
    val content: String,
    val timestamp: Long = System.currentTimeMillis(),
    val thinking: String? = null,
    val thinkingDurationMs: Long? = null,
    val citations: List<Citation> = emptyList(),
    val toolsUsed: List<ToolCall> = emptyList(),
    val attachments: List<MessageAttachment> = emptyList(),
    val isStreaming: Boolean = false,
    val isAgentExecution: Boolean = false,
    val agentSteps: List<AgentStep> = emptyList(),
    val createdDocumentId: String? = null,
    val createdDocumentName: String? = null,
    val isFavorite: Boolean = false,
    val isPinned: Boolean = false,
    val tags: List<String> = emptyList()
)
