package com.vukko.data.local.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.vukko.data.local.RoomConverters
import com.vukko.model.*

@Entity(
    tableName = "chat_messages",
    foreignKeys = [
        ForeignKey(
            entity = ChatThreadEntity::class,
            parentColumns = ["id"],
            childColumns = ["threadId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["threadId"]),
        Index(value = ["timestamp"]),
        Index(value = ["isFavorite"])
    ]
)
data class ChatMessageEntity(
    @PrimaryKey
    val id: String,
    val threadId: String,
    val sender: String, // "USER", "ASSISTANT", "SYSTEM"
    val content: String,
    val timestamp: Long = System.currentTimeMillis(),
    val thinking: String? = null,
    val thinkingDurationMs: Long? = null,
    val citationsJson: String = "[]",
    val toolsUsedJson: String = "[]",
    val attachmentsJson: String = "[]",
    val isStreaming: Boolean = false,
    val isAgentExecution: Boolean = false,
    val agentStepsJson: String = "[]",
    val createdDocumentId: String? = null,
    val createdDocumentName: String? = null,
    val isFavorite: Boolean = false,
    val isPinned: Boolean = false,
    val tagsJson: String = "[]"
) {
    fun toDomain(): ChatMessage {
        return ChatMessage(
            id = id,
            threadId = threadId,
            sender = try { MessageSender.valueOf(sender) } catch (_: Exception) { MessageSender.ASSISTANT },
            content = content,
            timestamp = timestamp,
            thinking = thinking,
            thinkingDurationMs = thinkingDurationMs,
            citations = RoomConverters.decodeCitations(citationsJson),
            toolsUsed = RoomConverters.decodeToolCalls(toolsUsedJson),
            attachments = RoomConverters.decodeAttachments(attachmentsJson),
            isStreaming = isStreaming,
            isAgentExecution = isAgentExecution,
            agentSteps = RoomConverters.decodeAgentSteps(agentStepsJson),
            createdDocumentId = createdDocumentId,
            createdDocumentName = createdDocumentName,
            isFavorite = isFavorite,
            isPinned = isPinned,
            tags = RoomConverters.decodeTags(tagsJson)
        )
    }

    companion object {
        fun fromDomain(msg: ChatMessage): ChatMessageEntity {
            return ChatMessageEntity(
                id = msg.id,
                threadId = msg.threadId,
                sender = msg.sender.name,
                content = msg.content,
                timestamp = msg.timestamp,
                thinking = msg.thinking,
                thinkingDurationMs = msg.thinkingDurationMs,
                citationsJson = RoomConverters.encodeCitations(msg.citations),
                toolsUsedJson = RoomConverters.encodeToolCalls(msg.toolsUsed),
                attachmentsJson = RoomConverters.encodeAttachments(msg.attachments),
                isStreaming = msg.isStreaming,
                isAgentExecution = msg.isAgentExecution,
                agentStepsJson = RoomConverters.encodeAgentSteps(msg.agentSteps),
                createdDocumentId = msg.createdDocumentId,
                createdDocumentName = msg.createdDocumentName,
                isFavorite = msg.isFavorite,
                isPinned = msg.isPinned,
                tagsJson = RoomConverters.encodeTags(msg.tags)
            )
        }
    }
}
