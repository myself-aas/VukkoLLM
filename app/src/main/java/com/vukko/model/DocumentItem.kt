package com.vukko.model

enum class DocumentType {
    TEXT,
    PDF,
    WEB_LINK,
    MARKDOWN
}

data class DocumentItem(
    val id: String,
    val workspaceId: String,
    val name: String,
    val type: DocumentType,
    val size: String,
    val vectorCount: Int,
    val contentSummary: String,
    val fullContent: String = "",
    val dateAdded: Long = System.currentTimeMillis()
)

data class QuickActionItem(
    val id: String,
    val title: String,
    val description: String,
    val promptTemplate: String,
    val iconName: String
)

object QuickActionsRegistry {
    val items = listOf(
        QuickActionItem("summarize", "Summarize", "Key takeaways and bullet points", "Provide a clear and concise summary of the following text with 3-5 key bullet points:\n\n%s", "text_snippet"),
        QuickActionItem("fix_grammar", "Fix & Polish", "Correct grammar, spelling, and tone", "Proofread, fix grammatical mistakes, and polish the wording of the following text while keeping its original meaning:\n\n%s", "auto_fix_high"),
        QuickActionItem("explain", "Explain Simply", "Simplify concepts for quick understanding", "Explain the following text in simple terms so anyone can understand it easily:\n\n%s", "psychology"),
        QuickActionItem("formalize", "Make Formal", "Transform text into a professional tone", "Rewrite the following text into professional, polished business communication:\n\n%s", "business_center"),
        QuickActionItem("translate", "Translate", "Translate into fluent English or target language", "Translate the following text into fluent English:\n\n%s", "translate")
    )
}
