/**
 * Phase 2/5: the model catalogue is one list, not three.
 *
 * `ProviderRegistry.defaultModels` is persisted data — `selected_model_id`
 * stores an id from it — so a model that exists in Kotlin but not in the
 * TypeScript picker is a model the user can no longer choose, and one that
 * exists in TypeScript but not in Rust is a model the bridge cannot resolve.
 *
 * The Kotlin source is the origin. Both ports are read back out of source and
 * compared field by field, in order, so a silent divergence fails here.
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const KOTLIN = join(ROOT, 'app', 'src', 'main', 'java', 'com', 'vukko', 'model', 'LLMProvider.kt');
const RUST = join(ROOT, 'rust', 'crates', 'vukko-core', 'src', 'domain', 'provider.rs');

/** Parses `LLMModel("id", "Name", ProviderType.X, "ctx", supportsVision = true, ...)`. */
function kotlinCatalogue() {
  const source = readFileSync(KOTLIN, 'utf8');
  const body = source.slice(
    source.indexOf('val defaultModels'),
    source.indexOf('fun getModelsFor'),
  );
  const models = [];
  const pattern =
    /LLMModel\(\s*"([^"]+)",\s*"([^"]+)",\s*ProviderType\.(\w+),\s*"([^"]+)"([^)]*)\)/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const [, id, name, provider, contextWindow, rest] = match;
    models.push({
      id,
      name,
      provider,
      contextWindow,
      supportsVision: /supportsVision\s*=\s*true/.test(rest),
      supportsReasoning: /supportsReasoning\s*=\s*true/.test(rest),
    });
  }
  return models;
}

/** Parses the `model(...)` calls inside `pub fn default_models()`. */
function rustCatalogue() {
  const source = readFileSync(RUST, 'utf8');
  const start = source.indexOf('pub fn default_models()');
  const body = source.slice(start, source.indexOf('pub fn models_for'));
  const models = [];
  const pattern =
    /model\(\s*"([^"]+)",\s*"([^"]+)",\s*(\w+),\s*"([^"]+)",\s*(true|false),\s*(true|false),?\s*\)/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const [, id, name, provider, contextWindow, vision, reasoning] = match;
    models.push({
      id,
      name,
      provider,
      contextWindow,
      supportsVision: vision === 'true',
      supportsReasoning: reasoning === 'true',
    });
  }
  return models;
}

/** The TypeScript catalogue, imported through its public entry point. */
function typescriptCatalogue() {
  jest.resetModules();
  const provider = require('../../src/types/provider');
  if (!Array.isArray(provider.DEFAULT_MODELS)) {
    throw new Error('src/types/provider.ts must export DEFAULT_MODELS');
  }
  return provider.DEFAULT_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
    contextWindow: model.contextWindow,
    supportsVision: model.supportsVision,
    supportsReasoning: model.supportsReasoning,
  }));
}

describe('model catalogue parity', () => {
  const kotlin = kotlinCatalogue();

  test('the Kotlin source still parses into the shipped 15 models', () => {
    // Guard against a parse that silently yields [] and passes everything else.
    expect(kotlin.length).toBe(15);
    expect(kotlin[0].id).toBe('gemini-2.5-flash');
  });

  test('TypeScript ships the same models, in the same order', () => {
    expect(typescriptCatalogue()).toEqual(kotlin);
  });

  test('Rust ships the same models, in the same order', () => {
    expect(rustCatalogue()).toEqual(kotlin);
  });

  test('every provider in the Kotlin enum owns at least one model', () => {
    const types = new Set(kotlin.map((model) => model.provider));
    expect([...types].sort()).toEqual(
      ['ANTHROPIC', 'DEEPSEEK', 'GEMINI', 'GROQ', 'INSTANCE', 'OLLAMA', 'OPENAI'].sort(),
    );
  });
});
