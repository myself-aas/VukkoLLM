package com.vukko.model

import com.vukko.R

enum class ProviderType(val displayName: String, val iconRes: Int, val isLocal: Boolean = false) {
    GEMINI("Google Gemini", R.drawable.ic_provider_gemini),
    OPENAI("OpenAI", R.drawable.ic_provider_openai),
    ANTHROPIC("Anthropic", R.drawable.ic_provider_anthropic),
    DEEPSEEK("DeepSeek", R.drawable.ic_provider_deepseek),
    GROQ("Groq", R.drawable.ic_provider_groq),
    OLLAMA("Ollama (Local/LAN)", R.drawable.ic_provider_ollama, true),
    INSTANCE("Vukko Server", R.drawable.anything_llm_icon)
}

data class LLMModel(
    val id: String,
    val name: String,
    val provider: ProviderType,
    val contextWindow: String,
    val supportsVision: Boolean = false,
    val supportsReasoning: Boolean = false
)

data class ProviderConfig(
    val provider: ProviderType,
    val apiKey: String = "",
    val baseUrl: String = "",
    val selectedModelId: String,
    val temperature: Float = 0.7f,
    val maxTokens: Int = 4096,
    val isConnected: Boolean = true
)

object ProviderRegistry {
    val defaultModels = listOf(
        // Gemini
        LLMModel("gemini-2.5-flash", "Gemini 2.5 Flash", ProviderType.GEMINI, "1M", supportsVision = true, supportsReasoning = true),
        LLMModel("gemini-2.5-pro", "Gemini 2.5 Pro", ProviderType.GEMINI, "2M", supportsVision = true, supportsReasoning = true),
        LLMModel("gemini-1.5-flash", "Gemini 1.5 Flash", ProviderType.GEMINI, "1M", supportsVision = true),

        // DeepSeek
        LLMModel("deepseek-chat", "DeepSeek-V3", ProviderType.DEEPSEEK, "64k", supportsReasoning = false),
        LLMModel("deepseek-reasoner", "DeepSeek-R1 (Reasoning)", ProviderType.DEEPSEEK, "64k", supportsReasoning = true),

        // OpenAI
        LLMModel("gpt-4o", "GPT-4o", ProviderType.OPENAI, "128k", supportsVision = true),
        LLMModel("gpt-4o-mini", "GPT-4o mini", ProviderType.OPENAI, "128k", supportsVision = true),
        LLMModel("o3-mini", "o3-mini (Reasoning)", ProviderType.OPENAI, "128k", supportsReasoning = true),

        // Anthropic
        LLMModel("claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet", ProviderType.ANTHROPIC, "200k", supportsVision = true),
        LLMModel("claude-3-5-haiku-20241022", "Claude 3.5 Haiku", ProviderType.ANTHROPIC, "200k"),

        // Groq
        LLMModel("llama-3.3-70b-versatile", "Llama 3.3 70B (Groq)", ProviderType.GROQ, "128k"),
        LLMModel("mixtral-8x7b-32768", "Mixtral 8x7B (Groq)", ProviderType.GROQ, "32k"),

        // Ollama
        LLMModel("llama3.2:latest", "Llama 3.2 3B (Local)", ProviderType.OLLAMA, "8k", supportsVision = false),
        LLMModel("deepseek-r1:8b", "DeepSeek R1 8B (Local)", ProviderType.OLLAMA, "8k", supportsReasoning = true),

        // Instance
        LLMModel("vukko-workspace-default", "Instance Workspace LLM", ProviderType.INSTANCE, "Dynamic", supportsVision = true)
    )

    fun getModelsFor(provider: ProviderType): List<LLMModel> {
        return defaultModels.filter { it.provider == provider }
    }

    fun findModel(modelId: String): LLMModel {
        return defaultModels.find { it.id == modelId } ?: defaultModels.first()
    }
}
