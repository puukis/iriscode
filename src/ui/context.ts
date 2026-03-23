import React, { createContext, useContext } from 'react';
import type { MutableRefObject } from 'react';
import type { ResolvedConfig } from '../config/schema.ts';
import type { Session } from '../agent/session.ts';
import type { CommandRegistry } from '../commands/registry.ts';
import type { PermissionEngine } from '../permissions/engine.ts';
import type { DiffInterceptor } from '../diff/interceptor.ts';
import type { GraphTracker } from '../graph/tracker.ts';
import type { InputRouter } from './input-router.ts';
import type { LoadedMemoryFile, SessionSnapshotSummary } from '../commands/types.ts';
import type { PermissionMode } from '../permissions/types.ts';
import type { McpRegistry } from '../mcp/registry.ts';
import type { HookRegistry } from '../hooks/registry.ts';
import type { PluginLoadResult } from '../plugins/types.ts';
import type { SkillLoadResult } from '../skills/types.ts';

export interface IrisToolCallMessage {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  startedAt: number;
  durationMs?: number;
}

export type IrisMessage =
  | {
      id: string;
      kind: 'system';
      role: 'system';
      text: string;
      createdAt: number;
      complete: true;
    }
  | {
      id: string;
      kind: 'user-text';
      role: 'user';
      text: string;
      isMeta?: boolean;
      commandName?: string;
      createdAt: number;
      complete: true;
    }
  | {
      id: string;
      kind: 'assistant-text';
      role: 'assistant';
      text: string;
      createdAt: number;
      complete: boolean;
      isStreaming: boolean;
    }
  | {
      id: string;
      kind: 'assistant-tool-use';
      role: 'assistant';
      calls: IrisToolCallMessage[];
      createdAt: number;
      complete: boolean;
    };

export interface IrisRuntimeStore {
  messagesRef: MutableRefObject<IrisMessage[]>;
  modelRef: MutableRefObject<string>;
  modeRef: MutableRefObject<PermissionMode>;
  isStreamingRef: MutableRefObject<boolean>;
  isBusyRef: MutableRefObject<boolean>;
  sessionIdRef: MutableRefObject<string>;
  sendMessageRef: MutableRefObject<(text: string) => Promise<void>>;
  sendCommandRef: MutableRefObject<(text: string) => Promise<'handled' | 'passthrough'>>;
  cancelRef: MutableRefObject<() => void>;
  exitRef: MutableRefObject<() => Promise<void> | void>;
}

export interface IrisContextValue {
  cwd: string;
  initialConfig: ResolvedConfig;
  initialMemoryFiles: LoadedMemoryFile[];
  modelOverride?: string;
  modeOverride?: PermissionMode;
  sessionRef: MutableRefObject<Session | null>;
  configRef: MutableRefObject<ResolvedConfig>;
  commandRegistryRef: MutableRefObject<CommandRegistry | null>;
  permissionEngineRef: MutableRefObject<PermissionEngine>;
  diffInterceptorRef: MutableRefObject<DiffInterceptor>;
  graphTrackerRef: MutableRefObject<GraphTracker | null>;
  inputRouterRef: MutableRefObject<InputRouter>;
  mcpRegistry: McpRegistry;
  skillResult: SkillLoadResult;
  hookRegistry: HookRegistry;
  pluginResult: PluginLoadResult;
  runtime: IrisRuntimeStore;
  sessionPickerResolverRef: MutableRefObject<((session?: SessionSnapshotSummary) => void) | null>;
}

export const IrisContext = createContext<IrisContextValue | null>(null);

export function useIris(): IrisContextValue {
  const value = useContext(IrisContext);
  if (!value) {
    throw new Error('useIris() must be used inside <IrisContext.Provider>.');
  }
  return value;
}
