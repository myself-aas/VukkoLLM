package com.vukko.data.local.dao

import androidx.room.*
import com.vukko.data.local.entities.ChatThreadEntity
import com.vukko.data.local.entities.ThreadWithMessages
import kotlinx.coroutines.flow.Flow

@Dao
interface ChatThreadDao {

    @Query("SELECT * FROM chat_threads WHERE workspaceId = :workspaceId ORDER BY isPinned DESC, updatedAt DESC, createdAt DESC")
    fun getThreadsByWorkspace(workspaceId: String): Flow<List<ChatThreadEntity>>

    @Query("SELECT * FROM chat_threads WHERE workspaceId = :workspaceId ORDER BY isPinned DESC, updatedAt DESC, createdAt DESC")
    suspend fun getThreadsByWorkspaceDirect(workspaceId: String): List<ChatThreadEntity>

    @Query("SELECT * FROM chat_threads ORDER BY updatedAt DESC")
    suspend fun getAllThreadsDirect(): List<ChatThreadEntity>

    @Query("SELECT * FROM chat_threads WHERE id = :id LIMIT 1")
    suspend fun getThreadById(id: String): ChatThreadEntity?

    @Transaction
    @Query("SELECT * FROM chat_threads WHERE id = :id LIMIT 1")
    fun getThreadWithMessages(id: String): Flow<ThreadWithMessages?>

    @Transaction
    @Query("SELECT * FROM chat_threads WHERE id = :id LIMIT 1")
    suspend fun getThreadWithMessagesDirect(id: String): ThreadWithMessages?

    @Transaction
    @Query("SELECT * FROM chat_threads WHERE workspaceId = :workspaceId ORDER BY isPinned DESC, updatedAt DESC")
    fun getThreadsWithMessagesByWorkspace(workspaceId: String): Flow<List<ThreadWithMessages>>

    @Query("SELECT * FROM chat_threads WHERE workspaceId = :workspaceId AND name LIKE '%' || :query || '%' ORDER BY isPinned DESC, updatedAt DESC")
    fun searchThreads(workspaceId: String, query: String): Flow<List<ChatThreadEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertThread(thread: ChatThreadEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertThreads(threads: List<ChatThreadEntity>)

    @Update
    suspend fun updateThread(thread: ChatThreadEntity)

    @Query("UPDATE chat_threads SET isPinned = :isPinned WHERE id = :threadId")
    suspend fun setThreadPinned(threadId: String, isPinned: Boolean)

    @Query("UPDATE chat_threads SET name = :name, updatedAt = :updatedAt WHERE id = :threadId")
    suspend fun renameThread(threadId: String, name: String, updatedAt: Long = System.currentTimeMillis())

    @Query("DELETE FROM chat_threads WHERE id = :id")
    suspend fun deleteThreadById(id: String)

    @Query("DELETE FROM chat_threads WHERE workspaceId = :workspaceId")
    suspend fun deleteThreadsByWorkspace(workspaceId: String)

    @Query("SELECT COUNT(*) FROM chat_threads")
    suspend fun getTotalThreadCount(): Int

    @Query("UPDATE chat_threads SET messageCount = (SELECT COUNT(*) FROM chat_messages WHERE threadId = :threadId), lastMessageSnippet = :snippet, updatedAt = :updatedAt WHERE id = :threadId")
    suspend fun refreshThreadStats(threadId: String, snippet: String? = null, updatedAt: Long = System.currentTimeMillis())
}
