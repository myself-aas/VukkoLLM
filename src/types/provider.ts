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

/**
 * The shipped catalogue, copied verbatim from `ProviderRegistry.defaultModels`.
 *
 * Order is part of the contract: `findModel` falls back to the first entry, so
 * a reordered list would silently change the model an unknown id resolves to.
 * Ids are persisted (`selected_model_id`), so none may ever be renamed.
 */
export const DEFAULT_MODELS: readonly LLMModel[] = [
  // Gemini
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'GEMINI',
    contextWindow: '1M',
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'GEMINI',
    contextWindow: '2M',
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'GEMINI',
    contextWindow: '1M',
    supportsVision: true,
    supportsReasoning: false,
  },

  // DeepSeek
  {
    id: 'deepseek-chat',
    name: 'DeepSeek-V3',
    provider: 'DEEPSEEK',
    contextWindow: '64k',
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek-R1 (Reasoning)',
    provider: 'DEEPSEEK',
    contextWindow: '64k',
    supportsVision: false,
    supportsReasoning: true,
  },

  // OpenAI
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OPENAI',
    contextWindow: '128k',
    supportsVision: true,
    supportsReasoning: false,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'OPENAI',
    contextWindow: '128k',
    supportsVision: true,
    supportsReasoning: false,
  },
  {
    id: 'o3-mini',
    name: 'o3-mini (Reasoning)',
    provider: 'OPENAI',
    contextWindow: '128k',
    supportsVision: false,
    supportsReasoning: true,
  },

  // Anthropic
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'ANTHROPIC',
    contextWindow: '200k',
    supportsVision: true,
    supportsReasoning: false,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'ANTHROPIC',
    contextWindow: '200k',
    supportsVision: false,
    supportsReasoning: false,
  },

  // Groq
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B (Groq)',
    provider: 'GROQ',
    contextWindow: '128k',
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B (Groq)',
    provider: 'GROQ',
    contextWindow: '32k',
    supportsVision: false,
    supportsReasoning: false,
  },

  // Ollama
  {
    id: 'llama3.2:latest',
    name: 'Llama 3.2 3B (Local)',
    provider: 'OLLAMA',
    contextWindow: '8k',
    supportsVision: false,
    supportsReasoning: false,
  },
  {
    id: 'deepseek-r1:8b',
    name: 'DeepSeek R1 8B (Local)',
    provider: 'OLLAMA',
    contextWindow: '8k',
    supportsVision: false,
    supportsReasoning: true,
  },

  // Instance
  {
    id: 'vukko-workspace-default',
    name: 'Instance Workspace LLM',
    provider: 'INSTANCE',
    contextWindow: 'Dynamic',
    supportsVision: true,
    supportsReasoning: false,
  },
];

/** The models one provider owns, in catalogue order. Mirrors `getModelsFor`. */
export function modelsFor(provider: ProviderType): LLMModel[] {
  return DEFAULT_MODELS.filter((model) => model.provider === provider);
}

/**
 * Looks a model up by id, falling back to the first catalogue entry exactly like
 * `ProviderRegistry.findModel` — an id persisted by an older build must never
 * leave the app with no model at all.
 */
export function findModel(modelId: string): LLMModel {
  // `DEFAULT_MODELS` is a non-empty literal; the zero index is asserted here so
  // the signature stays `LLMModel` without an `undefined` arm callers must handle.
  const found = DEFAULT_MODELS.find((model) => model.id === modelId) ?? DEFAULT_MODELS[0];
  return found as LLMModel;
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
