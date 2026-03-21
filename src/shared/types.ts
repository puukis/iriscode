export type Role = 'user' | 'assistant' | 'system';

export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolUseId?: string;
  content: string;
  isError?: boolean;
}

export interface SessionState {
  messages: Message[];
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}
export type { PermissionMode } from '../permissions/types.ts';

export interface DiffResult {
  filePath: string;
  before: string;
  after: string;
}

export interface StreamEvent {
  type: 'text' | 'tool_call' | 'done';
  text?: string;
  toolCall?: ToolCall;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface StreamParams {
  messages: Message[];
  tools: ToolDefinitionSchema[];
  systemPrompt?: string;
  maxTokens?: number;
}

export interface ToolDefinitionSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}
