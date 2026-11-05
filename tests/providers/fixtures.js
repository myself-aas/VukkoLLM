/**
 * Recorded provider payloads.
 *
 * These are trimmed copies of what each backend actually streams (OpenAI and
 * Ollama SSE, Anthropic Messages SSE, Gemini `streamGenerateContent`, and the
 * Vukko instance server's own JSONL protocol). Both the TypeScript parsers in
 * `src/services/providers` and the Rust parsers in
 * `rust/crates/vukko-core/src/providers` are tested against these exact strings,
 * so a backend change breaks a test instead of silently changing the chat
 * transcript.
 *
 * `expected` is the normalised chunk sequence each parser must produce. The
 * normalised vocabulary is deliberately tiny:
 *   { kind: 'text',      text }
 *   { kind: 'reasoning', text }
 *   { kind: 'tool_call', toolName, input }
 *   { kind: 'usage',     inputTokens, outputTokens }
 *   { kind: 'done',      finishReason }
 */
const openaiSse = [
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"DocumentRAG","arguments":"{\\"query\\":\\"sovereignty\\"}"}}]},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":42,"completion_tokens":11,"total_tokens":53}}',
  '',
  'data: [DONE]',
  '',
].join('\n');

const openaiExpected = [
  { kind: 'text', text: 'Hello' },
  { kind: 'text', text: ' there' },
  { kind: 'tool_call', toolName: 'DocumentRAG', input: '{"query":"sovereignty"}' },
  { kind: 'usage', inputTokens: 42, outputTokens: 11 },
  { kind: 'done', finishReason: 'tool_calls' },
];

/** OpenAI-compatible reasoning models emit `reasoning_content`. */
const deepseekReasoningSse = [
  'data: {"id":"c1","choices":[{"index":0,"delta":{"reasoning_content":"Let me think"}}]}',
  '',
  'data: {"id":"c1","choices":[{"index":0,"delta":{"reasoning_content":" about it."}}]}',
  '',
  'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"Answer."}}]}',
  '',
  'data: [DONE]',
  '',
].join('\n');

const deepseekExpected = [
  { kind: 'reasoning', text: 'Let me think' },
  { kind: 'reasoning', text: ' about it.' },
  { kind: 'text', text: 'Answer.' },
  { kind: 'done', finishReason: 'stop' },
];

const anthropicSse = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-3-5-sonnet-20241022","usage":{"input_tokens":25,"output_tokens":1}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Bonjour"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Considering tone."}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"WebSearch","input":{}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"news\\"}"}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":64}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

const anthropicExpected = [
  { kind: 'text', text: 'Bonjour' },
  { kind: 'reasoning', text: 'Considering tone.' },
  { kind: 'tool_call', toolName: 'WebSearch', input: '{"query":"news"}' },
  { kind: 'usage', inputTokens: 25, outputTokens: 64 },
  { kind: 'done', finishReason: 'end_turn' },
];

const geminiStream = [
  {
    candidates: [
      {
        content: { parts: [{ text: 'Hola' }], role: 'model' },
        finishReason: 'STOP',
      },
    ],
  },
  {
    candidates: [
      {
        content: { parts: [{ text: ' mundo' }], role: 'model' },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7, totalTokenCount: 19 },
  },
];

const geminiExpected = [
  { kind: 'text', text: 'Hola' },
  { kind: 'text', text: ' mundo' },
  { kind: 'usage', inputTokens: 12, outputTokens: 7 },
  { kind: 'done', finishReason: 'STOP' },
];

/** Gemini 2.5 emits thought parts. */
const geminiThoughtStream = [
  {
    candidates: [
      {
        content: {
          parts: [{ text: 'Weighing options.', thought: true }, { text: 'Final answer.' }],
          role: 'model',
        },
        finishReason: 'STOP',
      },
    ],
  },
];

const geminiThoughtExpected = [
  { kind: 'reasoning', text: 'Weighing options.' },
  { kind: 'text', text: 'Final answer.' },
  { kind: 'done', finishReason: 'STOP' },
];

const ollamaNdjson = [
  {
    model: 'llama3.2:latest',
    created_at: '2024-01-01T00:00:00Z',
    message: { role: 'assistant', content: 'Loc' },
    done: false,
  },
  { model: 'llama3.2:latest', message: { role: 'assistant', content: 'al' }, done: false },
  {
    model: 'llama3.2:latest',
    message: { role: 'assistant', content: '' },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 9,
    eval_count: 2,
  },
];

const ollamaExpected = [
  { kind: 'text', text: 'Loc' },
  { kind: 'text', text: 'al' },
  { kind: 'usage', inputTokens: 9, outputTokens: 2 },
  { kind: 'done', finishReason: 'stop' },
];

const instanceNdjson = [
  { type: 'delta', text: 'Streaming' },
  { type: 'delta', text: ' from the instance' },
  {
    type: 'citation',
    title: 'whitepaper.pdf',
    source: 'Section 2',
    snippet: 'hybrid RAG',
    score: 0.91,
  },
  { type: 'done', finishReason: 'stop', usage: { input: 30, output: 8 } },
];

const instanceExpected = [
  { kind: 'text', text: 'Streaming' },
  { kind: 'text', text: ' from the instance' },
  {
    kind: 'citation',
    citation: { title: 'whitepaper.pdf', source: 'Section 2', snippet: 'hybrid RAG', score: 0.91 },
  },
  { kind: 'usage', inputTokens: 30, outputTokens: 8 },
  { kind: 'done', finishReason: 'stop' },
];

/** The body each provider returns when a key is rejected. */
const errorBodies = {
  openai: {
    status: 401,
    body: JSON.stringify({
      error: {
        message: 'Incorrect API key provided',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    }),
  },
  anthropic: {
    status: 401,
    body: JSON.stringify({
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    }),
  },
  gemini: {
    status: 403,
    body: JSON.stringify({
      error: {
        code: 403,
        message: 'API key not valid. Please pass a valid API key.',
        status: 'PERMISSION_DENIED',
      },
    }),
  },
  ollama: {
    status: 404,
    body: JSON.stringify({ error: 'model "llama3.2:latest" not found, try pulling it first' }),
  },
  instance: { status: 502, body: 'Bad Gateway' },
};

/** Body a provider returns when the prompt exceeds the context window. */
const contextLimitBody = {
  status: 400,
  body: JSON.stringify({
    error: {
      message:
        "This model's maximum context length is 128000 tokens. However, your messages resulted in 130512 tokens.",
      code: 'context_length_exceeded',
    },
  }),
};

module.exports = {
  openaiSse,
  openaiExpected,
  deepseekReasoningSse,
  deepseekExpected,
  anthropicSse,
  anthropicExpected,
  geminiStream,
  geminiExpected,
  geminiThoughtStream,
  geminiThoughtExpected,
  ollamaNdjson,
  ollamaExpected,
  instanceNdjson,
  instanceExpected,
  errorBodies,
  contextLimitBody,
};
