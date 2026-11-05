package com.vukko.data.local.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.vukko.model.WorkspaceThread

@Entity(
    tableName = "chat_threads",
    foreignKeys = [
        ForeignKey(
            entity = WorkspaceEntity::class,
            parentColumns = ["id"],
            childColumns = ["workspaceId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["workspaceId"]),
        Index(value = ["updatedAt"]),
        Index(value = ["isPinned"])
    ]
)
data class ChatThreadEntity(
    @PrimaryKey
    val id: String,
    val workspaceId: String,
    val name: String,
    val slug: String,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val messageCount: Int = 0,
    val lastMessageSnippet: String? = null,
    val isPinned: Boolean = false
) {
    fun toDomain(): WorkspaceThread {
        return WorkspaceThread(
            id = id,
            workspaceId = workspaceId,
            name = name,
            slug = slug,
            createdAt = createdAt,
            updatedAt = updatedAt,
            messageCount = messageCount,
            lastMessageSnippet = lastMessageSnippet,
            isPinned = isPinned
        )
    }

    companion object {
        fun fromDomain(thread: WorkspaceThread): ChatThreadEntity {
            return ChatThreadEntity(
                id = thread.id,
                workspaceId = thread.workspaceId,
                name = thread.name,
                slug = thread.slug,
                createdAt = thread.createdAt,
                updatedAt = thread.updatedAt,
                messageCount = thread.messageCount,
                lastMessageSnippet = thread.lastMessageSnippet,
                isPinned = thread.isPinned
            )
        }
    }
}
