package com.vukko.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.vukko.data.local.entities.ChatMessageEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ChatMessageDao {

    @Query("SELECT * FROM chat_messages WHERE threadId = :threadId ORDER BY timestamp ASC")
    fun getMessagesByThread(threadId: String): Flow<List<ChatMessageEntity>>

    @Query("SELECT * FROM chat_messages WHERE threadId = :threadId ORDER BY timestamp ASC")
    suspend fun getMessagesByThreadDirect(threadId: String): List<ChatMessageEntity>

    @Query("SELECT * FROM chat_messages WHERE id = :id LIMIT 1")
    suspend fun getMessageById(id: String): ChatMessageEntity?

    @Query("SELECT * FROM chat_messages WHERE threadId = :threadId ORDER BY timestamp DESC LIMIT 1")
    suspend fun getLastMessageInThread(threadId: String): ChatMessageEntity?

    @Query("SELECT * FROM chat_messages ORDER BY timestamp DESC LIMIT 1")
    suspend fun getGlobalLastMessage(): ChatMessageEntity?

    @Query("SELECT * FROM chat_messages WHERE threadId = :threadId AND content LIKE '%' || :keyword || '%' ORDER BY timestamp DESC")
    fun searchMessagesInThread(threadId: String, keyword: String): Flow<List<ChatMessageEntity>>

    @Query("SELECT * FROM chat_messages WHERE content LIKE '%' || :keyword || '%' ORDER BY timestamp DESC LIMIT 50")
    fun searchAllMessages(keyword: String): Flow<List<ChatMessageEntity>>

    @Query("SELECT * FROM chat_messages WHERE threadId = :threadId AND isFavorite = 1 ORDER BY timestamp DESC")
    fun getFavoriteMessagesByThread(threadId: String): Flow<List<ChatMessageEntity>>

    @Query("SELECT * FROM chat_messages WHERE threadId = :threadId AND tagsJson LIKE '%' || '\"' || :tag || '\"' || '%' ORDER BY timestamp DESC")
    fun getMessagesByTag(threadId: String, tag: String): Flow<List<ChatMessageEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: ChatMessageEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessages(messages: List<ChatMessageEntity>)

    @Update
    suspend fun updateMessage(message: ChatMessageEntity)

    @Query("UPDATE chat_messages SET isFavorite = :isFavorite WHERE id = :messageId")
    suspend fun setMessageFavorite(messageId: String, isFavorite: Boolean)

    @Query("UPDATE chat_messages SET isPinned = :isPinned WHERE id = :messageId")
    suspend fun setMessagePinned(messageId: String, isPinned: Boolean)

    @Query("SELECT * FROM chat_messages WHERE threadId = :threadId AND isPinned = 1 ORDER BY timestamp DESC")
    fun getPinnedMessagesByThread(threadId: String): Flow<List<ChatMessageEntity>>

    @Query("DELETE FROM chat_messages WHERE id = :id")
    suspend fun deleteMessageById(id: String)

    @Query("DELETE FROM chat_messages WHERE threadId = :threadId")
    suspend fun deleteMessagesByThread(threadId: String)

    @Query("SELECT COUNT(*) FROM chat_messages")
    suspend fun getTotalMessageCount(): Int

    @Query("SELECT COUNT(*) FROM chat_messages WHERE threadId = :threadId")
    suspend fun getMessageCountForThread(threadId: String): Int
}
