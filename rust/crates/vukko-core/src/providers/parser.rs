//! Stream parsers for each wire protocol.
//!
//! Every parser is a pure function over a complete response body, so they can be
//! tested against the recorded payloads in `tests/providers/fixtures.js` without
//! a network. A payload that fails to parse yields a `NETWORK` error rather than
//! ending the stream silently, so a truncated response is visible.

use crate::domain::{Citation, ErrorCode, ProviderError};

use super::{ProviderChunk, Protocol};

/// Result of parsing a body: the chunks in order, and the first fatal error.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedStream {
    pub chunks: Vec<ProviderChunk>,
    pub error: Option<ProviderError>,
}

fn malformed(payload: &str) -> ProviderError {
    ProviderError::network("malformed provider response", true)
        .with_detail("payload", payload.chars().take(120).collect::<String>())
}

fn sse_payloads(raw: &str) -> Vec<String> {
    raw.lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|payload| payload.trim_start().to_string())
        .collect()
}

fn ndjson_payloads(raw: &str) -> Vec<String> {
    raw.lines()
        .map(|line| line.trim())
        .map(|line| line.strip_prefix("data:").unwrap_or(line).trim_start())
        .filter(|line| line.starts_with('{'))
        .map(|line| line.to_string())
        .collect()
}

/// Parses a response body according to `protocol`.
pub fn parse_stream(protocol: Protocol, raw: &str) -> ParsedStream {
    match protocol {
        Protocol::OpenAiSse => parse_openai(raw),
        Protocol::AnthropicSse => parse_anthropic(raw),
        Protocol::GeminiStream => parse_gemini(raw),
        Protocol::OllamaNdjson => parse_ollama(raw),
        Protocol::InstanceNdjson => parse_instance(raw),
    }
}

fn parse_openai(raw: &str) -> ParsedStream {
    let mut parsed = ParsedStream::default();
    let mut stream_ended = false;

    for payload in sse_payloads(raw) {
        if payload == "[DONE]" {
            if !stream_ended {
                parsed.chunks.push(ProviderChunk::Done {
                    finish_reason: "stop".into(),
                });
                stream_ended = true;
            }
            continue;
        }

        let Ok(frame) = serde_json::from_str::<serde_json::Value>(&payload) else {
            parsed.error.get_or_insert_with(|| malformed(&payload));
            continue;
        };

        let choice = frame.get("choices").and_then(|choices| choices.get(0));
        let delta = choice.and_then(|choice| choice.get("delta"));

        if let Some(text) = delta
            .and_then(|delta| delta.get("content"))
            .and_then(|content| content.as_str())
        {
            if !text.is_empty() {
                parsed.chunks.push(ProviderChunk::Text { text: text.to_string() });
            }
        }
        if let Some(reasoning) = delta
            .and_then(|delta| delta.get("reasoning_content"))
            .and_then(|content| content.as_str())
        {
            if !reasoning.is_empty() {
                parsed.chunks.push(ProviderChunk::Reasoning {
                    text: reasoning.to_string(),
                });
            }
        }
        if let Some(tool_calls) = delta
            .and_then(|delta| delta.get("tool_calls"))
            .and_then(|calls| calls.as_array())
        {
            for call in tool_calls {
                let function = call.get("function");
                let name = function
                    .and_then(|function| function.get("name"))
                    .and_then(|name| name.as_str());
                if let Some(name) = name {
                    parsed.chunks.push(ProviderChunk::ToolCall {
                        tool_name: name.to_string(),
                        input: function
                            .and_then(|function| function.get("arguments"))
                            .and_then(|arguments| arguments.as_str())
                            .unwrap_or("{}")
                            .to_string(),
                    });
                }
            }
        }
        if let Some(usage) = frame.get("usage") {
            let input_tokens = usage.get("prompt_tokens").and_then(|value| value.as_u64()).unwrap_or(0);
            let output_tokens = usage
                .get("completion_tokens")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            if output_tokens > 0 || !parsed.chunks.iter().any(|chunk| matches!(chunk, ProviderChunk::Usage { .. })) {
                parsed.chunks.push(ProviderChunk::Usage {
                    input_tokens: input_tokens as u32,
                    output_tokens: output_tokens as u32,
                });
            }
        }
        if let Some(finish_reason) = choice
            .and_then(|choice| choice.get("finish_reason"))
            .and_then(|reason| reason.as_str())
        {
            if !stream_ended {
                parsed.chunks.push(ProviderChunk::Done {
                    finish_reason: finish_reason.to_string(),
                });
                stream_ended = true;
            }
        }
    }
    parsed
}

fn parse_anthropic(raw: &str) -> ParsedStream {
    let mut parsed = ParsedStream::default();
    let mut input_tokens = 0u32;
    let mut output_tokens = 0u32;
    let mut stop_reason: Option<String> = None;
    let mut tool: Option<(u64, String, String)> = None;

    for payload in sse_payloads(raw) {
        let Ok(frame) = serde_json::from_str::<serde_json::Value>(&payload) else {
            parsed.error.get_or_insert_with(|| malformed(&payload));
            continue;
        };

        match frame.get("type").and_then(|value| value.as_str()).unwrap_or_default() {
            "message_start" => {
                input_tokens = frame
                    .get("message")
                    .and_then(|message| message.get("usage"))
                    .and_then(|usage| usage.get("input_tokens"))
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0) as u32;
            }
            "content_block_start" => {
                let block = frame.get("content_block");
                if block.and_then(|block| block.get("type")).and_then(|value| value.as_str())
                    == Some("tool_use")
                {
                    tool = Some((
                        frame.get("index").and_then(|value| value.as_u64()).unwrap_or(0),
                        block
                            .and_then(|block| block.get("name"))
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        String::new(),
                    ));
                }
            }
            "content_block_delta" => {
                let delta = frame.get("delta");
                let delta_type = delta
                    .and_then(|delta| delta.get("type"))
                    .and_then(|value| value.as_str())
                    .unwrap_or_default();
                match delta_type {
                    "text_delta" => {
                        if let Some(text) = delta
                            .and_then(|delta| delta.get("text"))
                            .and_then(|value| value.as_str())
                        {
                            parsed.chunks.push(ProviderChunk::Text { text: text.to_string() });
                        }
                    }
                    "thinking_delta" => {
                        if let Some(text) = delta
                            .and_then(|delta| delta.get("thinking"))
                            .and_then(|value| value.as_str())
                        {
                            parsed.chunks.push(ProviderChunk::Reasoning {
                                text: text.to_string(),
                            });
                        }
                    }
                    "input_json_delta" => {
                        if let Some((_, _, buffer)) = tool.as_mut() {
                            if let Some(partial) = delta
                                .and_then(|delta| delta.get("partial_json"))
                                .and_then(|value| value.as_str())
                            {
                                buffer.push_str(partial);
                            }
                        }
                    }
                    _ => {}
                }
            }
            "content_block_stop" => {
                let index = frame.get("index").and_then(|value| value.as_u64()).unwrap_or(0);
                if let Some((tool_index, name, buffer)) = tool.take() {
                    if tool_index == index {
                        let input = if buffer.is_empty() { "{}".to_string() } else { buffer };
                        parsed.chunks.push(ProviderChunk::ToolCall { tool_name: name, input });
                    }
                }
            }
            "message_delta" => {
                if let Some(tokens) = frame
                    .get("usage")
                    .and_then(|usage| usage.get("output_tokens"))
                    .and_then(|value| value.as_u64())
                {
                    output_tokens = tokens as u32;
                }
                if let Some(reason) = frame
                    .get("delta")
                    .and_then(|delta| delta.get("stop_reason"))
                    .and_then(|value| value.as_str())
                {
                    stop_reason = Some(reason.to_string());
                }
            }
            "error" => {
                let message = frame
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("provider error");
                let error_type = frame
                    .get("error")
                    .and_then(|error| error.get("type"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("unknown");
                let code = if error_type.contains("authentication") || error_type.contains("permission")
                {
                    ErrorCode::AUTHENTICATION
                } else {
                    ErrorCode::NETWORK
                };
                parsed.error.get_or_insert(ProviderError {
                    code,
                    message: message.to_string(),
                    retryable: code == ErrorCode::NETWORK,
                    details: None,
                });
            }
            _ => {}
        }
    }

    if let Some((_, name, buffer)) = tool.take() {
        // The recorded stream can end right after the last fragment; flushing
        // here keeps the tool call instead of dropping it.
        let input = if buffer.is_empty() { "{}".to_string() } else { buffer };
        parsed.chunks.push(ProviderChunk::ToolCall { tool_name: name, input });
    }
    if input_tokens > 0 || output_tokens > 0 {
        parsed.chunks.push(ProviderChunk::Usage {
            input_tokens,
            output_tokens,
        });
    }
    if let Some(reason) = stop_reason {
        parsed.chunks.push(ProviderChunk::Done { finish_reason: reason });
    }
    parsed
}

fn parse_gemini(raw: &str) -> ParsedStream {
    let mut parsed = ParsedStream::default();
    let mut pending_finish: Option<String> = None;

    // Gemini streams JSON objects; with `alt=sse` they arrive SSE-framed, and a
    // bare JSON body is equally valid.
    let frames: Vec<String> = if raw.contains("data:") {
        sse_payloads(raw)
    } else {
        raw.split("}\n{")
            .map(|frame| {
                let mut frame = frame.to_string();
                if !frame.starts_with('{') {
                    frame.insert(0, '{');
                }
                if !frame.ends_with('}') {
                    frame.push('}');
                }
                frame
            })
            .filter(|frame| frame.trim().len() > 2)
            .collect()
    };

    for payload in frames {
        let Ok(frame) = serde_json::from_str::<serde_json::Value>(payload.trim()) else {
            parsed.error.get_or_insert_with(|| malformed(&payload));
            continue;
        };

        let candidate = frame.get("candidates").and_then(|candidates| candidates.get(0));
        if let Some(parts) = candidate
            .and_then(|candidate| candidate.get("content"))
            .and_then(|content| content.get("parts"))
            .and_then(|parts| parts.as_array())
        {
            for part in parts {
                let Some(text) = part.get("text").and_then(|value| value.as_str()) else {
                    continue;
                };
                if text.is_empty() {
                    continue;
                }
                let is_thought = part
                    .get("thought")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                parsed.chunks.push(if is_thought {
                    ProviderChunk::Reasoning { text: text.to_string() }
                } else {
                    ProviderChunk::Text { text: text.to_string() }
                });
            }
        }

        if let Some(usage) = frame.get("usageMetadata") {
            parsed.chunks.push(ProviderChunk::Usage {
                input_tokens: usage
                    .get("promptTokenCount")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0) as u32,
                output_tokens: usage
                    .get("candidatesTokenCount")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0) as u32,
            });
        }

        if let Some(reason) = candidate
            .and_then(|candidate| candidate.get("finishReason"))
            .and_then(|value| value.as_str())
        {
            pending_finish = Some(reason.to_string());
        }
    }

    if let Some(reason) = pending_finish {
        // `done` is emitted once, after usage, so the UI closes the stream last.
        parsed.chunks.push(ProviderChunk::Done { finish_reason: reason });
    }
    parsed
}

fn parse_ollama(raw: &str) -> ParsedStream {
    let mut parsed = ParsedStream::default();
    for payload in ndjson_payloads(raw) {
        let Ok(frame) = serde_json::from_str::<serde_json::Value>(&payload) else {
            parsed.error.get_or_insert_with(|| malformed(&payload));
            continue;
        };
        if let Some(error) = frame.get("error").and_then(|value| value.as_str()) {
            parsed.error.get_or_insert_with(|| ProviderError::network(error, false));
            continue;
        }
        let message = frame.get("message");
        if let Some(text) = message.and_then(|message| message.get("content")).and_then(|value| value.as_str()) {
            if !text.is_empty() {
                parsed.chunks.push(ProviderChunk::Text { text: text.to_string() });
            }
        }
        if let Some(thinking) = message
            .and_then(|message| message.get("thinking"))
            .and_then(|value| value.as_str())
        {
            if !thinking.is_empty() {
                parsed.chunks.push(ProviderChunk::Reasoning { text: thinking.to_string() });
            }
        }
        if frame.get("done").and_then(|value| value.as_bool()).unwrap_or(false) {
            if frame.get("prompt_eval_count").is_some() || frame.get("eval_count").is_some() {
                parsed.chunks.push(ProviderChunk::Usage {
                    input_tokens: frame
                        .get("prompt_eval_count")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0) as u32,
                    output_tokens: frame.get("eval_count").and_then(|value| value.as_u64()).unwrap_or(0)
                        as u32,
                });
            }
            parsed.chunks.push(ProviderChunk::Done {
                finish_reason: frame
                    .get("done_reason")
                    .and_then(|value| value.as_str())
                    .unwrap_or("stop")
                    .to_string(),
            });
        }
    }
    parsed
}

fn parse_instance(raw: &str) -> ParsedStream {
    let mut parsed = ParsedStream::default();
    for payload in ndjson_payloads(raw) {
        let Ok(frame) = serde_json::from_str::<serde_json::Value>(&payload) else {
            parsed.error.get_or_insert_with(|| malformed(&payload));
            continue;
        };
        match frame.get("type").and_then(|value| value.as_str()).unwrap_or_default() {
            "delta" => {
                if let Some(text) = frame.get("text").and_then(|value| value.as_str()) {
                    parsed.chunks.push(ProviderChunk::Text { text: text.to_string() });
                }
            }
            "reasoning" => {
                if let Some(text) = frame.get("text").and_then(|value| value.as_str()) {
                    parsed.chunks.push(ProviderChunk::Reasoning { text: text.to_string() });
                }
            }
            "citation" => {
                parsed.chunks.push(ProviderChunk::Citation {
                    citation: Citation {
                        title: frame
                            .get("title")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        source: frame
                            .get("source")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        snippet: frame
                            .get("snippet")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        score: frame
                            .get("score")
                            .and_then(|value| value.as_f64())
                            .unwrap_or(0.0) as f32,
                    },
                });
            }
            "done" => {
                if let Some(usage) = frame.get("usage") {
                    parsed.chunks.push(ProviderChunk::Usage {
                        input_tokens: usage.get("input").and_then(|value| value.as_u64()).unwrap_or(0)
                            as u32,
                        output_tokens: usage.get("output").and_then(|value| value.as_u64()).unwrap_or(0)
                            as u32,
                    });
                }
                parsed.chunks.push(ProviderChunk::Done {
                    finish_reason: frame
                        .get("finishReason")
                        .and_then(|value| value.as_str())
                        .unwrap_or("stop")
                        .to_string(),
                });
            }
            "error" => {
                let code = if frame.get("code").and_then(|value| value.as_str())
                    == Some("AUTHENTICATION")
                {
                    ErrorCode::AUTHENTICATION
                } else {
                    ErrorCode::NETWORK
                };
                parsed.error.get_or_insert(ProviderError {
                    code,
                    message: frame
                        .get("message")
                        .and_then(|value| value.as_str())
                        .unwrap_or("instance server error")
                        .to_string(),
                    retryable: code == ErrorCode::NETWORK,
                    details: None,
                });
            }
            _ => {}
        }
    }
    parsed
}

#[cfg(test)]
mod tests {
    use super::*;

    const OPENAI: &str = concat!(
        "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\" there\"},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"function\":{\"name\":\"DocumentRAG\",\"arguments\":\"{\\\"query\\\":\\\"sovereignty\\\"}\"}}]},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":42,\"completion_tokens\":11}}\n\n",
        "data: [DONE]\n\n",
    );

    #[test]
    fn openai_stream_normalises_text_tools_usage_and_done() {
        let parsed = parse_stream(Protocol::OpenAiSse, OPENAI);
        assert!(parsed.error.is_none());
        assert_eq!(
            parsed.chunks,
            vec![
                ProviderChunk::Text { text: "Hello".into() },
                ProviderChunk::Text { text: " there".into() },
                ProviderChunk::ToolCall {
                    tool_name: "DocumentRAG".into(),
                    input: "{\"query\":\"sovereignty\"}".into()
                },
                ProviderChunk::Usage { input_tokens: 42, output_tokens: 11 },
                ProviderChunk::Done { finish_reason: "tool_calls".into() },
            ]
        );
    }

    #[test]
    fn reasoning_deltas_never_mix_into_the_answer() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Let me think\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Answer.\"}}]}\n\n",
            "data: [DONE]\n\n",
        );
        let parsed = parse_stream(Protocol::OpenAiSse, raw);
        assert_eq!(
            parsed.chunks,
            vec![
                ProviderChunk::Reasoning { text: "Let me think".into() },
                ProviderChunk::Text { text: "Answer.".into() },
                ProviderChunk::Done { finish_reason: "stop".into() },
            ]
        );
    }

    #[test]
    fn anthropic_stream_reassembles_tool_arguments() {
        let raw = concat!(
            "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":25}}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Bonjour\"}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"Considering tone.\"}}\n\n",
            "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"name\":\"WebSearch\"}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"query\\\":\\\"news\\\"}\"}}\n\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":64}}\n\n",
        );
        let parsed = parse_stream(Protocol::AnthropicSse, raw);
        assert!(parsed.chunks.contains(&ProviderChunk::ToolCall {
            tool_name: "WebSearch".into(),
            input: "{\"query\":\"news\"}".into()
        }));
        assert_eq!(
            parsed.chunks.last(),
            Some(&ProviderChunk::Done { finish_reason: "end_turn".into() })
        );
        assert!(parsed.chunks.contains(&ProviderChunk::Usage { input_tokens: 25, output_tokens: 64 }));
    }

    #[test]
    fn gemini_stream_handles_bare_json_and_thought_parts() {
        let raw = concat!(
            "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Weighing options.\",\"thought\":true},{\"text\":\"Final answer.\"}]},\"finishReason\":\"STOP\"}]}",
        );
        let parsed = parse_stream(Protocol::GeminiStream, raw);
        assert_eq!(
            parsed.chunks,
            vec![
                ProviderChunk::Reasoning { text: "Weighing options.".into() },
                ProviderChunk::Text { text: "Final answer.".into() },
                ProviderChunk::Done { finish_reason: "STOP".into() },
            ]
        );
    }

    #[test]
    fn ollama_ndjson_reports_usage_on_the_final_frame() {
        let raw = concat!(
            "{\"message\":{\"content\":\"Loc\"},\"done\":false}\n",
            "{\"message\":{\"content\":\"al\"},\"done\":false}\n",
            "{\"done\":true,\"done_reason\":\"stop\",\"prompt_eval_count\":9,\"eval_count\":2}\n",
        );
        let parsed = parse_stream(Protocol::OllamaNdjson, raw);
        assert_eq!(
            parsed.chunks,
            vec![
                ProviderChunk::Text { text: "Loc".into() },
                ProviderChunk::Text { text: "al".into() },
                ProviderChunk::Usage { input_tokens: 9, output_tokens: 2 },
                ProviderChunk::Done { finish_reason: "stop".into() },
            ]
        );
    }

    #[test]
    fn instance_ndjson_carries_citations() {
        let raw = concat!(
            "{\"type\":\"delta\",\"text\":\"Streaming\"}\n",
            "{\"type\":\"citation\",\"title\":\"whitepaper.pdf\",\"source\":\"Section 2\",\"snippet\":\"hybrid RAG\",\"score\":0.91}\n",
            "{\"type\":\"done\",\"finishReason\":\"stop\",\"usage\":{\"input\":30,\"output\":8}}\n",
        );
        let parsed = parse_stream(Protocol::InstanceNdjson, raw);
        assert!(matches!(
            parsed.chunks[1],
            ProviderChunk::Citation { .. }
        ));
        assert_eq!(parsed.chunks.last(), Some(&ProviderChunk::Done { finish_reason: "stop".into() }));
    }

    #[test]
    fn malformed_payloads_become_errors_not_silence() {
        let parsed = parse_stream(Protocol::OpenAiSse, "data: {\"choices\":[{");
        assert_eq!(parsed.error.map(|error| error.code), Some(ErrorCode::NETWORK));
    }

    #[test]
    fn a_ping_only_stream_yields_nothing() {
        let parsed = parse_stream(Protocol::OpenAiSse, "event: ping\n\n");
        assert!(parsed.chunks.is_empty());
        assert!(parsed.error.is_none());
    }
}
