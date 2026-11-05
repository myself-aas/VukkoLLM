/**
 * Provider contract. Mirrors model/LLMProvider.kt.
 *
 * `ProviderType` wire values and the model IDs in `DEFAULT_MODELS` are part of
 * the compatibility surface: they are persisted in the Room database and in
 * SharedPreferences, so they may be added to but never renamed.
 */

/** Wire values are the Kotlin enum names. Order matches ProviderType.kt. */
export type ProviderType =
  | 'GEMINI'
  | 'OPENAI'
  | 'ANTHROPIC'
  | 'DEEPSEEK'
  | 'GROQ'
  | 'OLLAMA'
  | 'INSTANCE';

export interface LLMModel {
  id: string;
  name: string;
  provider: ProviderType;
  /** Human-readable window size ("128k", "1M", "Dynamic"). */
  contextWindow: string;
  supportsVision: boolean;
  supportsReasoning: boolean;
}

export interface ProviderConfig {
  provider: ProviderType;
  /** Never persisted in the JS layer; the bridge hands out an opaque handle. */
  apiKey: string;
  baseUrl: string;
  selectedModelId: string;
  temperature: number;
  maxTokens: number;
  isConnected: boolean;
}

/** Display metadata for the picker; icons are resolved natively by name. */
export interface ProviderDescriptor {
  type: ProviderType;
  displayName: string;
  iconName: string;
  isLocal: boolean;
}

export const PROVIDERS: readonly ProviderDescriptor[] = [
  { type: 'GEMINI', displayName: 'Google Gemini', iconName: 'ic_provider_gemini', isLocal: false },
  { type: 'OPENAI', displayName: 'OpenAI', iconName: 'ic_provider_openai', isLocal: false },
  {
    type: 'ANTHROPIC',
    displayName: 'Anthropic',
    iconName: 'ic_provider_anthropic',
    isLocal: false,
  },
  { type: 'DEEPSEEK', displayName: 'DeepSeek', iconName: 'ic_provider_deepseek', isLocal: false },
  { type: 'GROQ', displayName: 'Groq', iconName: 'ic_provider_groq', isLocal: false },
  {
    type: 'OLLAMA',
    displayName: 'Ollama (Local/LAN)',
    iconName: 'ic_provider_ollama',
    isLocal: true,
  },
  { type: 'INSTANCE', displayName: 'Vukko Server', iconName: 'anything_llm_icon', isLocal: false },
] as const;
