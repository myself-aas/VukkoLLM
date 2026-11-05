package com.vukko.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.vukko.data.local.entities.WorkspaceDocumentEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface WorkspaceDocumentDao {

    @Query("SELECT * FROM workspace_documents WHERE workspaceId = :workspaceId ORDER BY dateAdded DESC")
    fun getDocumentsByWorkspace(workspaceId: String): Flow<List<WorkspaceDocumentEntity>>

    @Query("SELECT * FROM workspace_documents WHERE workspaceId = :workspaceId ORDER BY dateAdded DESC")
    suspend fun getDocumentsByWorkspaceDirect(workspaceId: String): List<WorkspaceDocumentEntity>

    @Query("SELECT * FROM workspace_documents ORDER BY dateAdded DESC")
    suspend fun getAllDocumentsDirect(): List<WorkspaceDocumentEntity>

    @Query("SELECT * FROM workspace_documents WHERE id = :id LIMIT 1")
    suspend fun getDocumentById(id: String): WorkspaceDocumentEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDocument(document: WorkspaceDocumentEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDocuments(documents: List<WorkspaceDocumentEntity>)

    @Update
    suspend fun updateDocument(document: WorkspaceDocumentEntity)

    @Query("DELETE FROM workspace_documents WHERE id = :id")
    suspend fun deleteDocumentById(id: String)

    @Query("DELETE FROM workspace_documents WHERE workspaceId = :workspaceId")
    suspend fun deleteDocumentsByWorkspace(workspaceId: String)

    @Query("SELECT COUNT(*) FROM workspace_documents")
    suspend fun getTotalDocumentCount(): Int

    @Query("SELECT SUM(vectorCount) FROM workspace_documents WHERE workspaceId = :workspaceId")
    suspend fun getTotalVectorsForWorkspace(workspaceId: String): Int?
}
