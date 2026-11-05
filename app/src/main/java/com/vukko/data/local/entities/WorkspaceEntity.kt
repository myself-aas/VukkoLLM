package com.vukko.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.vukko.model.QueryMode
import com.vukko.model.Workspace

@Entity(tableName = "workspaces")
data class WorkspaceEntity(
    @PrimaryKey
    val id: String,
    val name: String,
    val slug: String,
    val description: String = "",
    val systemPrompt: String = "You are a helpful, versatile AI assistant powered by Vukko.",
    val temperature: Float = 0.7f,
    val queryMode: String = "CHAT",
    val vectorCount: Int = 0,
    val documentCount: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val agentMaxSteps: Int = 5,
    val agentAllowWebSearch: Boolean = true,
    val agentAllowFileCreation: Boolean = true,
    val agentAllowDocumentSearch: Boolean = true
) {
    fun toDomain(): Workspace {
        return Workspace(
            id = id,
            name = name,
            slug = slug,
            description = description,
            systemPrompt = systemPrompt,
            temperature = temperature,
            queryMode = try { QueryMode.valueOf(queryMode) } catch (_: Exception) { QueryMode.CHAT },
            vectorCount = vectorCount,
            documentCount = documentCount,
            createdAt = createdAt,
            agentMaxSteps = agentMaxSteps,
            agentAllowWebSearch = agentAllowWebSearch,
            agentAllowFileCreation = agentAllowFileCreation,
            agentAllowDocumentSearch = agentAllowDocumentSearch
        )
    }

    companion object {
        fun fromDomain(ws: Workspace): WorkspaceEntity {
            return WorkspaceEntity(
                id = ws.id,
                name = ws.name,
                slug = ws.slug,
                description = ws.description,
                systemPrompt = ws.systemPrompt,
                temperature = ws.temperature,
                queryMode = ws.queryMode.name,
                vectorCount = ws.vectorCount,
                documentCount = ws.documentCount,
                createdAt = ws.createdAt,
                agentMaxSteps = ws.agentMaxSteps,
                agentAllowWebSearch = ws.agentAllowWebSearch,
                agentAllowFileCreation = ws.agentAllowFileCreation,
                agentAllowDocumentSearch = ws.agentAllowDocumentSearch
            )
        }
    }
}
