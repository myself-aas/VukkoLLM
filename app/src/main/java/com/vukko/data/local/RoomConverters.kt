package com.vukko.data.local

import androidx.room.TypeConverter
import com.vukko.model.AgentStep
import com.vukko.model.Citation
import com.vukko.model.MessageAttachment
import com.vukko.model.ToolCall
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

object RoomConverters {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    @TypeConverter
    @JvmStatic
    fun encodeCitations(citations: List<Citation>?): String {
        if (citations.isNullOrEmpty()) return "[]"
        return try {
            json.encodeToString(citations)
        } catch (_: Exception) {
            "[]"
        }
    }

    @TypeConverter
    @JvmStatic
    fun decodeCitations(raw: String?): List<Citation> {
        if (raw.isNullOrBlank() || raw == "[]") return emptyList()
        return try {
            json.decodeFromString(raw)
        } catch (_: Exception) {
            emptyList()
        }
    }

    @TypeConverter
    @JvmStatic
    fun encodeToolCalls(tools: List<ToolCall>?): String {
        if (tools.isNullOrEmpty()) return "[]"
        return try {
            json.encodeToString(tools)
        } catch (_: Exception) {
            "[]"
        }
    }

    @TypeConverter
    @JvmStatic
    fun decodeToolCalls(raw: String?): List<ToolCall> {
        if (raw.isNullOrBlank() || raw == "[]") return emptyList()
        return try {
            json.decodeFromString(raw)
        } catch (_: Exception) {
            emptyList()
        }
    }

    @TypeConverter
    @JvmStatic
    fun encodeAttachments(attachments: List<MessageAttachment>?): String {
        if (attachments.isNullOrEmpty()) return "[]"
        return try {
            json.encodeToString(attachments)
        } catch (_: Exception) {
            "[]"
        }
    }

    @TypeConverter
    @JvmStatic
    fun decodeAttachments(raw: String?): List<MessageAttachment> {
        if (raw.isNullOrBlank() || raw == "[]") return emptyList()
        return try {
            json.decodeFromString(raw)
        } catch (_: Exception) {
            emptyList()
        }
    }

    @TypeConverter
    @JvmStatic
    fun encodeAgentSteps(steps: List<AgentStep>?): String {
        if (steps.isNullOrEmpty()) return "[]"
        return try {
            json.encodeToString(steps)
        } catch (_: Exception) {
            "[]"
        }
    }

    @TypeConverter
    @JvmStatic
    fun decodeAgentSteps(raw: String?): List<AgentStep> {
        if (raw.isNullOrBlank() || raw == "[]") return emptyList()
        return try {
            json.decodeFromString(raw)
        } catch (_: Exception) {
            emptyList()
        }
    }

    @TypeConverter
    @JvmStatic
    fun encodeTags(tags: List<String>?): String {
        if (tags.isNullOrEmpty()) return "[]"
        return try {
            json.encodeToString(tags)
        } catch (_: Exception) {
            "[]"
        }
    }

    @TypeConverter
    @JvmStatic
    fun decodeTags(raw: String?): List<String> {
        if (raw.isNullOrBlank() || raw == "[]") return emptyList()
        return try {
            json.decodeFromString(raw)
        } catch (_: Exception) {
            emptyList()
        }
    }
}
