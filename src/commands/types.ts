import type { CostEntry, CostTracker } from '../cost/tracker.ts';
import type { ResolvedConfig } from '../config/schema.ts';
import type { DiffDecision } from '../diff/controller.ts';
import type { DiffStore } from '../diff/store.ts';
import type { PermissionEngine } from '../permissions/engine.ts';
import type { PermissionMode } from '../permissions/types.ts';
import type { DiffResult, Message, ToolDefinitionSchema } from '../shared/types.ts';
import type { HookRegistry } from '../hooks/registry.ts';
import type { PluginLoadResult } from '../plugins/types.ts';
import type { SkillLoadResult } from '../skills/types.ts';

export type CommandCategory = 'builtin' | 'custom' | 'skill';

export type MemoryMenuAction = 'clear-project' | 'clear-global' | 'edit-project' | 'edit-global';

export type McpMenuAction =
  | 'list-servers'
  | 'show-tools'
  | 'reconnect'
  | 'login'
  | 'add-server'
  | 'remove-server';

export interface PickerOption {
  label: string;
  value: string;
  description?: string;
}

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
  readonly cwd: string;
  costTracker: CostTracker;
  diffStore: DiffStore;
  clear(): void;
  compact(summary: string): void;
  setModel(model: string): Promise<void> | void;
  setMode(mode: PermissionMode): void;
  runPrompt(request: PromptExecutionRequest): Promise<void>;
  executePrompt(request: DetachedPromptRequest): Promise<string>;
  writeInfo(text: string): void;
  writeError(text: string): void;
  showCommand(text: string): void;
  resumeUi(): void;
  ask(question: string): Promise<string>;
  getToolDefinitions(allowedTools?: string[]): ToolDefinitionSchema[];
  openModelPicker(): Promise<string | undefined>;
  openSessionPicker(sessions: SessionSnapshotSummary[]): Promise<SessionSnapshotSummary | undefined>;
  openMemoryMenu(): Promise<MemoryMenuAction | undefined>;
  openMcpMenu(): Promise<McpMenuAction | undefined>;
  openPicker(options: PickerOption[], title?: string): Promise<string | undefined>;
  viewDiff(diff: DiffResult, options?: { readOnly?: boolean; autoAccept?: boolean }): Promise<DiffDecision | void>;
  restoreSession(snapshot: SessionSnapshot): void;
  refreshContext(): Promise<void>;
  addMessage?(message: Message): void;
  setNextPromptModelOverride?(model: string | null): void;
  consumeNextPromptModelOverride?(): string | undefined;
}

export interface CommandContext {
  args: string[];
  session: SessionState;
  config: ResolvedConfig;
  engine: PermissionEngine;
  cwd: string;
  registry?: import('./registry.ts').CommandRegistry;
  compactionManager?: import('../memory/compaction.ts').CompactionManager;
  modelRegistry?: import('../models/registry.ts').ModelRegistry;
  mcpRegistry?: import('../mcp/registry.ts').McpRegistry;
  skillResult?: SkillLoadResult;
  hookRegistry?: HookRegistry;
  pluginResult?: PluginLoadResult;
}

export type CommandResult =
  | { type: 'prompt'; text: string; allowedTools?: string[]; model?: string }
  | { type: 'handled' }
  | { type: 'error'; message: string };

export type BuiltinHandler = (ctx: CommandContext) => Promise<CommandResult>;
