/**
 * Agent execution contract.
 *
 * The Kotlin app ran a scripted agent loop that produced plausible-looking
 * steps (DataRepository.executeAgentMultiStepTask). The replacement keeps the
 * data model but only records steps that actually executed: a step is
 * `COMPLETED` when its tool returned, `FAILED` with the error captured in
 * `toolOutput`, never fabricated.
 */

import type { AgentStepStatus } from './chat';

export interface AgentExecution {
  messageId: string;
  steps: AgentStepRecord[];
  /** Unix milliseconds. */
  startedAt: number;
  /** Unix milliseconds; null while running. */
  finishedAt: number | null;
  status: AgentStepStatus;
}

export interface AgentStepRecord {
  stepIndex: number;
  title: string;
  description: string;
  toolName: string;
  status: AgentStepStatus;
  toolInput: string | null;
  toolOutput: string | null;
  executionTimeMs: number | null;
}

/** Tools the agent may call; names match the Kotlin toolName strings. */
export type AgentToolName =
  | 'Planner'
  | 'DocumentRAG'
  | 'WebSearch'
  | 'FileCreator'
  | 'DataSynthesizer';
