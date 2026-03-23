import type { ToolResult } from '../shared/types.ts';

export type HookEvent =
  | `tool:${string}`
  | 'agent:start'
  | 'agent:done'
  | 'agent:error'
  | 'session:start'
  | 'session:end';

export type HookTiming = 'pre' | 'post';

export interface HookDefinition {
  name: string;
  event: HookEvent;
  timing: HookTiming;
  description?: string;
  command: string;
  timeout_sec?: number;
  env?: Record<string, string>;
}

export interface HookContext {
  event: HookEvent;
  timing: HookTiming;
  toolName?: string;
  input?: Record<string, unknown>;
  result?: ToolResult;
  sessionId: string;
  pluginRoot?: string;
}

export interface HookResult {
  action: 'continue' | 'block' | 'modify';
  output?: string;
  blockReason?: string;
  modifiedInput?: Record<string, unknown>;
}
