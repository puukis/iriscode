import type { CostEntry, CostTracker } from '../cost/tracker.ts';
import type { ResolvedConfig } from '../config/schema.ts';
import type { PermissionEngine } from '../permissions/engine.ts';
import type { PermissionMode } from '../permissions/types.ts';
import type { Message, ToolDefinitionSchema } from '../shared/types.ts';

export type CommandCategory = 'builtin' | 'custom' | 'skill';

export interface CommandEntry {
  name: string;
  description: string;
  category: CommandCategory;
  argumentHint?: string;
  source?: string;
  allowedTools?: string[];
  model?: string;
}

export interface SessionDisplayMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export interface LoadedMemoryFile {
  path: string;
  lineCount: number;
  tokenCount: number;
  preview?: string;
}

export interface PromptExecutionRequest {
  text: string;
  allowedTools?: string[];
  model?: string;
  displayAssistantResponse?: boolean;
}

export interface DetachedPromptRequest {
  text: string;
  allowedTools?: string[];
  model?: string;
  systemPrompt?: string;
}

export interface SessionSnapshot {
  id: string;
  startedAt: number;
  model: string;
  permissionMode: PermissionMode;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  costEntries: CostEntry[];
  messages: Message[];
  displayMessages: SessionDisplayMessage[];
}

export interface SessionSnapshotSummary {
  id: string;
  startedAt: number;
  messageCount: number;
  totalCostUsd: number;
  model: string;
  path: string;
  finalMessage?: string;
}

export interface SessionState {
  id: string;
  startedAt: number;
  messages: Message[];
  displayMessages: SessionDisplayMessage[];
  model: string;
  permissionMode: PermissionMode;
  totalInputTokens: number;
  totalOutputTokens: number;
  contextText: string;
  memoryFiles: LoadedMemoryFile[];
  memoryMaxTokens: number;
  costTracker: CostTracker;
  clear(): void;
  compact(summary: string): void;
  setModel(model: string): Promise<void> | void;
  setMode(mode: PermissionMode): void;
  runPrompt(request: PromptExecutionRequest): Promise<void>;
  executePrompt(request: DetachedPromptRequest): Promise<string>;
  writeInfo(text: string): void;
  writeError(text: string): void;
  ask(question: string): Promise<string>;
  getToolDefinitions(allowedTools?: string[]): ToolDefinitionSchema[];
  openModelPicker(): Promise<string | undefined>;
  openSessionPicker(sessions: SessionSnapshotSummary[]): Promise<SessionSnapshotSummary | undefined>;
  restoreSession(snapshot: SessionSnapshot): void;
  refreshContext(): Promise<void>;
}

export interface CommandContext {
  args: string[];
  session: SessionState;
  config: ResolvedConfig;
  engine: PermissionEngine;
  cwd: string;
}

export type CommandResult =
  | { type: 'prompt'; text: string; allowedTools?: string[]; model?: string }
  | { type: 'handled' }
  | { type: 'error'; message: string };

export type BuiltinHandler = (ctx: CommandContext) => Promise<CommandResult>;
