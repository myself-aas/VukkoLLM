package com.vukko.data.local.entities

import androidx.room.Embedded
import androidx.room.Relation

/**
 * Room 1-to-Many relational POJO linking a chat thread directly to all its offline messages.
 */
data class ThreadWithMessages(
    @Embedded
    val thread: ChatThreadEntity,

    @Relation(
        parentColumn = "id",
        entityColumn = "threadId"
    )
    val messages: List<ChatMessageEntity>
)
