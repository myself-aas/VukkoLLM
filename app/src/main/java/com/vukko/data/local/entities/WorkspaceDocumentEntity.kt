package com.vukko.data.local.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.vukko.model.DocumentItem
import com.vukko.model.DocumentType

@Entity(
    tableName = "workspace_documents",
    foreignKeys = [
        ForeignKey(
            entity = WorkspaceEntity::class,
            parentColumns = ["id"],
            childColumns = ["workspaceId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["workspaceId"])
    ]
)
data class WorkspaceDocumentEntity(
    @PrimaryKey
    val id: String,
    val workspaceId: String,
    val name: String,
    val type: String, // "TEXT", "PDF", "WEB_LINK", "MARKDOWN"
    val size: String,
    val vectorCount: Int,
    val contentSummary: String,
    val fullContent: String = "",
    val dateAdded: Long = System.currentTimeMillis()
) {
    fun toDomain(): DocumentItem {
        return DocumentItem(
            id = id,
            workspaceId = workspaceId,
            name = name,
            type = try { DocumentType.valueOf(type) } catch (_: Exception) { DocumentType.TEXT },
            size = size,
            vectorCount = vectorCount,
            contentSummary = contentSummary,
            fullContent = fullContent,
            dateAdded = dateAdded
        )
    }

    companion object {
        fun fromDomain(doc: DocumentItem): WorkspaceDocumentEntity {
            return WorkspaceDocumentEntity(
                id = doc.id,
                workspaceId = doc.workspaceId,
                name = doc.name,
                type = doc.type.name,
                size = doc.size,
                vectorCount = doc.vectorCount,
                contentSummary = doc.contentSummary,
                fullContent = doc.fullContent,
                dateAdded = doc.dateAdded
            )
        }
    }
}
