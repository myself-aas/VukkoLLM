package com.vukko

import com.vukko.data.local.RoomConverters
import com.vukko.data.local.entities.ChatMessageEntity
import com.vukko.data.local.entities.ChatThreadEntity
import com.vukko.data.local.entities.WorkspaceDocumentEntity
import com.vukko.data.local.entities.WorkspaceEntity
import com.vukko.model.*
import org.junit.Assert.*
import org.junit.Test

class RoomDataSovereigntyTest {

    @Test
    fun testRoomConverters_CitationEncodingDecoding() {
        val citations = listOf(
            Citation("research_paper.pdf", "Section 3.2", "Data sovereignty guarantees on-device retention.", 0.98f),
            Citation("architecture.md", "Chunk 1", "Air-gapped database keeps data safe.", 0.92f)
        )

        val encoded = RoomConverters.encodeCitations(citations)
        assertNotNull(encoded)
        assertTrue(encoded.contains("research_paper.pdf"))

        val decoded = RoomConverters.decodeCitations(encoded)
        assertEquals(2, decoded.size)
        assertEquals("research_paper.pdf", decoded[0].title)
        assertEquals("Section 3.2", decoded[0].source)
        assertEquals(0.98f, decoded[0].score, 0.001f)
    }

    @Test
    fun testRoomConverters_AgentStepsEncodingDecoding() {
        val steps = listOf(
            AgentStep(1, "Goal Planning", "Decompose prompt into DAG", "Planner", AgentStepStatus.COMPLETED, "input1", "output1", 320L),
            AgentStep(2, "Local RAG Query", "Search embedded vectors", "DocumentRAG", AgentStepStatus.RUNNING, "query vectors", null, null)
        )

        val encoded = RoomConverters.encodeAgentSteps(steps)
        assertTrue(encoded.contains("Goal Planning"))

        val decoded = RoomConverters.decodeAgentSteps(encoded)
        assertEquals(2, decoded.size)
        assertEquals(AgentStepStatus.COMPLETED, decoded[0].status)
        assertEquals(AgentStepStatus.RUNNING, decoded[1].status)
        assertEquals("Planner", decoded[0].toolName)
    }

    @Test
    fun testWorkspaceEntity_DomainMapping() {
        val workspace = Workspace(
            id = "ws_test_sovereign",
            name = "Air-Gapped Sovereign Workspace",
            slug = "air-gapped-sovereign-workspace",
            description = "100% On-device private chat",
            systemPrompt = "Never leak personal data",
            temperature = 0.4f,
            queryMode = QueryMode.AGENT,
            vectorCount = 42,
            documentCount = 3
        )

        val entity = WorkspaceEntity.fromDomain(workspace)
        assertEquals("ws_test_sovereign", entity.id)
        assertEquals("AGENT", entity.queryMode)

        val restored = entity.toDomain()
        assertEquals(workspace.id, restored.id)
        assertEquals(workspace.name, restored.name)
        assertEquals(QueryMode.AGENT, restored.queryMode)
        assertEquals(42, restored.vectorCount)
    }

    @Test
    fun testChatMessageEntity_FullDomainRoundTrip() {
        val message = ChatMessage(
            id = "msg_sovereign_1",
            threadId = "th_sovereign_1",
            sender = MessageSender.ASSISTANT,
            content = "This response was computed and stored locally in Room SQLite.",
            timestamp = 1700000000000L,
            thinking = "Analyzing user prompt while maintaining zero network telemetry.",
            thinkingDurationMs = 850L,
            citations = listOf(Citation("local_doc.txt", "Part 1", "Local context only", 0.95f)),
            toolsUsed = listOf(ToolCall("Calculator", "Eval math", "40 + 2", "42")),
            attachments = listOf(MessageAttachment("att_1", "personal_notes.txt", "text/plain", "4 KB")),
            isAgentExecution = true,
            agentSteps = listOf(AgentStep(1, "Plan", "Decompose", "Planner", AgentStepStatus.COMPLETED)),
            createdDocumentId = "doc_gen_1",
            createdDocumentName = "report.md"
        )

        val entity = ChatMessageEntity.fromDomain(message)
        assertEquals("ASSISTANT", entity.sender)
        assertTrue(entity.isAgentExecution)
        assertEquals("report.md", entity.createdDocumentName)

        val restored = entity.toDomain()
        assertEquals(message.id, restored.id)
        assertEquals(MessageSender.ASSISTANT, restored.sender)
        assertEquals(message.content, restored.content)
        assertEquals(1, restored.citations.size)
        assertEquals("local_doc.txt", restored.citations[0].title)
        assertEquals(1, restored.toolsUsed.size)
        assertEquals("Calculator", restored.toolsUsed[0].toolName)
        assertEquals(1, restored.attachments.size)
        assertEquals("personal_notes.txt", restored.attachments[0].name)
        assertEquals(1, restored.agentSteps.size)
        assertEquals("Planner", restored.agentSteps[0].toolName)
    }

    @Test
    fun testWorkspaceDocumentEntity_Mapping() {
        val doc = DocumentItem(
            id = "doc_test_1",
            workspaceId = "ws_test_1",
            name = "confidential_plans.pdf",
            type = DocumentType.PDF,
            size = "1.2 MB",
            vectorCount = 64,
            contentSummary = "Confidential business plans kept on mobile storage."
        )

        val entity = WorkspaceDocumentEntity.fromDomain(doc)
        val restored = entity.toDomain()
        assertEquals(doc.id, restored.id)
        assertEquals(doc.name, restored.name)
        assertEquals(DocumentType.PDF, restored.type)
        assertEquals(64, restored.vectorCount)
    }
}
