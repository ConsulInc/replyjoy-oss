import { agentProviders } from "../config/agent-config.js";

export type AgentProvider = (typeof agentProviders)[number];

export type AgentAction =
  | { action: "read_thread"; threadId: string; reason: string }
  | { action: "search_mailbox"; query: string; maxResults?: number; reason: string }
  | { action: "read_message"; messageId: string; reason: string }
  | { action: "create_draft"; threadId: string; draft: string; reason: string }
  | { action: "skip_thread"; threadId: string; reason: string }
  | { action: "finish"; reason: string };
