//! Agent execution contract.
//!
//! Mirror of `src/types/agent.ts`. Steps are recorded as they execute; the
//! scripted pseudo-steps the Kotlin repository generated are gone.

use serde::{Deserialize, Serialize};

use super::chat::{AgentStepStatus, Timestamp};

/// Tools an agent may call. Wire names are the strings the Kotlin client wrote
/// into `agentStepsJson.toolName`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentToolName {
    #[serde(rename = "Planner")]
    Planner,
    #[serde(rename = "DocumentRAG")]
    DocumentRAG,
    #[serde(rename = "WebSearch")]
    WebSearch,
    #[serde(rename = "FileCreator")]
    FileCreator,
    #[serde(rename = "DataSynthesizer")]
    DataSynthesizer,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepRecord {
    pub step_index: u32,
    pub title: String,
    pub description: String,
    pub tool_name: String,
    pub status: AgentStepStatus,
    pub tool_input: Option<String>,
    pub tool_output: Option<String>,
    pub execution_time_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecution {
    pub message_id: String,
    pub steps: Vec<AgentStepRecord>,
    pub started_at: Timestamp,
    pub finished_at: Option<Timestamp>,
    pub status: AgentStepStatus,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_names_serialize_with_kotlin_strings() {
        assert_eq!(
            serde_json::to_string(&AgentToolName::DocumentRAG).unwrap(),
            "\"DocumentRAG\""
        );
        assert_eq!(
            serde_json::to_string(&AgentToolName::DataSynthesizer).unwrap(),
            "\"DataSynthesizer\""
        );
    }
}
