package com.vukko.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.vukko.data.local.dao.ChatMessageDao
import com.vukko.data.local.dao.ChatThreadDao
import com.vukko.data.local.dao.WorkspaceDao
import com.vukko.data.local.dao.WorkspaceDocumentDao
import com.vukko.data.local.entities.ChatMessageEntity
import com.vukko.data.local.entities.ChatThreadEntity
import com.vukko.data.local.entities.WorkspaceDocumentEntity
import com.vukko.data.local.entities.WorkspaceEntity

@Database(
    entities = [
        WorkspaceEntity::class,
        ChatThreadEntity::class,
        ChatMessageEntity::class,
        WorkspaceDocumentEntity::class
    ],
    version = 1,
    exportSchema = false
)
@TypeConverters(RoomConverters::class)
abstract class AppDatabase : RoomDatabase() {

    abstract fun workspaceDao(): WorkspaceDao
    abstract fun chatThreadDao(): ChatThreadDao
    abstract fun chatMessageDao(): ChatMessageDao
    abstract fun workspaceDocumentDao(): WorkspaceDocumentDao

    companion object {
        const val DATABASE_NAME = "vukko_sovereign.db"

        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    DATABASE_NAME
                )
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
