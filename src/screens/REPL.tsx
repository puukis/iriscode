import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { runAgentLoop, type ToolPermissionChoice } from '../agent/loop.ts';
import { Session } from '../agent/session.ts';
import { createHeadlessSession } from '../agent/headless-session.ts';
import { appendContextText, buildDefaultSystemPrompt } from '../agent/system-prompt.ts';
import { loadGlobalConfig } from '../config/global.ts';
import { loadProjectConfig } from '../config/project.ts';
import { reloadConfig } from '../config/loader.ts';
import { setApiKey } from '../config/secrets.ts';
import { createDefaultRegistry as createModelRegistry, parseModelString } from '../models/registry.ts';
import { PermissionEngine } from '../permissions/engine.ts';
import type { PermissionMode, PermissionRequest, PermissionResult } from '../permissions/types.ts';
import { bus } from '../shared/events.ts';
import type { Message, ToolDefinitionSchema } from '../shared/types.ts';
import { isAbortError } from '../shared/errors.ts';
import { createDefaultRegistry as createCommandRegistry, CommandRegistry } from '../commands/registry.ts';
import { loadCustomCommands } from '../commands/custom/loader.ts';
import { registerSkillCommands } from '../commands/skill-bridge.ts';
import type {
  LoadedMemoryFile,
  McpMenuAction,
  PickerOption,
  SessionSnapshotSummary,
} from '../commands/types.ts';
import { handleInput } from '../cli/input-handler.ts';
import { PermissionPrompt } from '../ui/components/permission-prompt.tsx';
import { DiffViewer } from '../ui/components/diff-viewer.tsx';
import { ModelPicker } from '../ui/components/model-picker.tsx';
import { SessionPicker } from '../ui/components/session-picker.tsx';
import { TaskGraph } from '../ui/components/task-graph.tsx';
import { CommandPalette } from '../ui/components/command-palette.tsx';
import { PromptInput } from '../ui/components/prompt-input.tsx';
import { CostBar } from '../ui/components/cost-bar.tsx';
import { ActivityPanel, type ActivityEntry } from '../ui/components/activity-panel.tsx';
import { AssistantTextMessage } from '../ui/components/messages/assistant-text-message.tsx';
import { AssistantToolUseMessage } from '../ui/components/messages/assistant-tool-use-message.tsx';
import { UserTextMessage } from '../ui/components/messages/user-text-message.tsx';
import { theme } from '../ui/theme.ts';
import { useIris, type IrisMessage } from '../ui/context.ts';
import type { DiffViewerRequest } from '../diff/controller.ts';
import { DiffViewerController } from '../diff/controller.ts';
import { DiffInterceptor } from '../diff/interceptor.ts';
import { DiffStore } from '../diff/store.ts';
import { Notifier } from '../ui/services/notifier.ts';
import { useTerminalSize } from '../ui/hooks/use-terminal-size.ts';
import { useBracketedPaste } from '../ui/stdin-proxy.ts';
import {
  createDefaultRegistry as createToolRegistry,
  type LoadedSkill,
} from '../tools/index.ts';
import { logger } from '../shared/logger.ts';
import { CompactionManager } from '../memory/compaction.ts';
import type { ModelRegistry } from '../models/registry.ts';
import { activatePlugin } from '../plugins/loader.ts';
import { runEventHooks } from '../hooks/runner.ts';

interface REPLProps {
  cwd: string;
  initialConfig: Awaited<ReturnType<typeof reloadConfig>>;
  initialMemoryFiles: LoadedMemoryFile[];
  modelOverride?: string;
  modeOverride?: PermissionMode;
  onCompactionManagerReady?: (cm: CompactionManager, registry: ModelRegistry) => void;
}

const MAX_ACTIVITY_ENTRIES = 120;

interface PendingPermissionPrompt {
  request: PermissionRequest;
  result: PermissionResult;
  tool?: ToolDefinitionSchema;
  resolve: (choice: ToolPermissionChoice) => void;
}

type OverlayState =
  | {
      kind: 'model-picker';
      availableModels: string[];
      resolve: (model?: string) => void;
    }
  | {
      kind: 'session-picker';
      sessions: SessionSnapshotSummary[];
      resolve: (session?: SessionSnapshotSummary) => void;
    }
  | {
      kind: 'memory-menu';
      resolve: (action?: import('../commands/types.ts').MemoryMenuAction) => void;
    }
  | {
      kind: 'picker';
      title: string;
      options: PickerOption[];
      resolve: (value?: string) => void;
    };

export function REPL({
  cwd,
  initialConfig,
  initialMemoryFiles,
  modelOverride,
  modeOverride,
  onCompactionManagerReady,
}: REPLProps) {
  const iris = useIris();
  const { exit } = useApp();
  const initialModel = normalizeModelKey(modelOverride ?? initialConfig.model);
  const initialMode = modeOverride ?? initialConfig.permissions.mode;
  const notifierRef = useRef(new Notifier(initialConfig));
  const { columns } = useTerminalSize();
  const [config, setConfig] = useState(initialConfig);
  const [memoryFiles, setMemoryFiles] = useState(initialMemoryFiles);
  const [activeModel, setActiveModel] = useState(initialModel);
  const [activeMode, setActiveMode] = useState(initialMode);
  const [messages, setMessages] = useState<IrisMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [questionInput, setQuestionInput] = useState('');
  const [pendingPermission, setPendingPermission] = useState<PendingPermissionPrompt | null>(null);
  const [pendingDiff, setPendingDiff] = useState<DiffViewerRequest | null>(null);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [commandRegistry, setCommandRegistry] = useState<CommandRegistry | null>(null);
  const [paletteEntries, setPaletteEntries] = useState<ReturnType<CommandRegistry['list']>>([]);
  const [paletteSelectedIndex, setPaletteSelectedIndex] = useState(0);
  const [contextUsage, setContextUsage] = useState<{ inputTokens: number; model: string } | null>(null);
  const [mcpConnectedCount, setMcpConnectedCount] = useState(
    () => iris.mcpRegistry.getServerStates().filter((state) => state.status === 'connected').length,
  );
  const [showActivity, setShowActivity] = useState(false);
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
  const [transcriptResetVersion, setTranscriptResetVersion] = useState(0);
  const historyRef = useRef<Message[]>([]);
  const loadedSkillsRef = useRef<LoadedSkill[]>([]);
  const totalInputTokensRef = useRef(0);
  const totalOutputTokensRef = useRef(0);
  const streamBufferRef = useRef('');
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingQuestionResolverRef = useRef<((answer: string) => void) | null>(null);
  const sessionCostRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef(0);
  const modelRegistryRef = useRef<ModelRegistry | null>(null);
  const compactionManagerRef = useRef<CompactionManager | null>(null);
  const commandHistory = useMemo(
    () =>
      messages
        .filter((message): message is Extract<IrisMessage, { kind: 'user-text' }> =>
          message.kind === 'user-text' && message.isMeta !== true,
        )
        .map((message) => message.text),
    [messages],
  );
  const diffStoreRef = useRef(new DiffStore());
  const diffControllerRef = useRef(
    new DiffViewerController((request) => {
      setPendingDiff(request);
    }),
  );
  const divider = useMemo(() => '─'.repeat(Math.max(20, columns - 4)), [columns]);
  const projectName = useMemo(() => cwd.split('/').filter(Boolean).at(-1) ?? cwd, [cwd]);
  const compactPath = useMemo(() => abbreviatePath(cwd), [cwd]);
  const providerLabel = useMemo(() => activeModel.split('/')[0] ?? 'model', [activeModel]);
  const promptIsActive = !pendingPermission && !pendingDiff && !overlay && !pendingQuestion;

  const appendActivityEntry = useCallback((entry: ActivityEntry) => {
    setActivityEntries((current) => {
      const next = [...current, entry];
      return next.length > MAX_ACTIVITY_ENTRIES
        ? next.slice(next.length - MAX_ACTIVITY_ENTRIES)
        : next;
    });
  }, []);

  const updateActivityEntry = useCallback((id: string, updater: (entry: ActivityEntry) => ActivityEntry) => {
    setActivityEntries((current) =>
      current.map((entry) => (entry.id === id ? updater(entry) : entry)),
    );
  }, []);

  const toggleActivity = useCallback(() => {
    setShowActivity((current) => !current);
  }, []);

  useEffect(() => {
    notifierRef.current = new Notifier(config);
  }, [config]);

  useEffect(() => {
    iris.runtime.exitRef.current = async () => {
      try {
        await iris.sessionRef.current?.save();
      } catch (error) {
        logger.warn(
          'Failed to save session before exit:',
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        exit();
      }
    };
  }, [exit, iris.runtime.exitRef, iris.sessionRef]);

  useEffect(() => {
    iris.runtime.messagesRef.current = messages;
    if (iris.sessionRef.current) {
      iris.sessionRef.current.displayMessages = toDisplayMessages(messages);
    }
  }, [iris.runtime.messagesRef, iris.sessionRef, messages]);

  useEffect(() => {
    iris.runtime.modelRef.current = activeModel;
    iris.runtime.modeRef.current = activeMode;
    iris.runtime.isBusyRef.current = running;
    iris.runtime.isStreamingRef.current = streaming;
    iris.configRef.current = config;
    iris.permissionEngineRef.current.setMode(activeMode);
  }, [activeMode, activeModel, config, iris, running, streaming]);

  useEffect(() => {
    iris.diffInterceptorRef.current = new DiffInterceptor(
      diffStoreRef.current,
      activeMode,
      diffControllerRef.current,
    );
  }, [activeMode, iris.diffInterceptorRef]);

  useEffect(() => {
    const syncToolCall = bus.on('tool:call', ({ id, name, input, startedAt }) => {
      setMessages((current) => {
        const last = current.at(-1);
        if (last?.kind === 'assistant-tool-use' && !last.complete) {
          return [
            ...current.slice(0, -1),
            {
              ...last,
              calls: [...last.calls, { id, name, input, startedAt }],
            },
          ];
        }
        return [
          ...current,
          {
            id: `tool-${id}`,
            kind: 'assistant-tool-use',
            role: 'assistant',
            createdAt: startedAt,
            complete: false,
            calls: [{ id, name, input, startedAt }],
          },
        ];
      });
      appendActivityEntry({
        id: `tool-${id}`,
        createdAt: startedAt,
        kind: 'tool',
        status: 'running',
        title: `Tool | ${name}`,
        detail: formatToolActivityDetail(name, input),
      });
    });

    const syncToolResult = bus.on('tool:result', ({ id, output, isError, durationMs }) => {
      setMessages((current) =>
        current.map((message) => {
          if (message.kind !== 'assistant-tool-use') {
            return message;
          }
          const calls = message.calls.map((call) =>
            call.id === id
              ? { ...call, output, isError, durationMs }
              : call,
          );
          return {
            ...message,
            calls,
            complete: calls.every((call) => typeof call.output === 'string'),
          };
        }),
      );
      updateActivityEntry(`tool-${id}`, (entry) => ({
        ...entry,
        status: isError ? 'error' : 'success',
        detail: [
          entry.detail,
          `Duration: ${durationMs}ms`,
          `Output: ${truncateForActivity(output, 1200)}`,
        ].filter(Boolean).join('\n\n'),
      }));
    });

    const syncConfigReload = bus.on('config:reloaded', ({ config: nextConfig }) => {
      setConfig(nextConfig);
    });

    const syncSessionMessage = bus.on('session:message-added', ({ sessionId, message }) => {
      if (sessionId !== iris.runtime.sessionIdRef.current) {
        return;
      }
      if (message.role !== 'user' || typeof message.content !== 'string') {
        return;
      }

      const nextMessage: IrisMessage = {
        id: `session-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'user-text',
        role: 'user',
        text: message.content,
        isMeta: message.isMeta,
        commandName: message.commandName,
        createdAt: Date.now(),
        complete: true,
      };

      setMessages((current) => [...current, nextMessage]);
    });

    const syncAgentStart = bus.on('agent:start', ({ depth, model, description }) => {
      appendActivityEntry({
        id: `agent-start-${Date.now()}-${depth}-${model}`,
        createdAt: Date.now(),
        kind: 'agent',
        status: 'running',
        title: `Agent | ${model}${depth > 0 ? ` | depth ${depth}` : ''}`,
        detail: summarizeAgentDescription(description),
      });
    });

    const syncAgentDone = bus.on('agent:done', ({ depth, model, description, response }) => {
      appendActivityEntry({
        id: `agent-done-${Date.now()}-${depth}-${model}`,
        createdAt: Date.now(),
        kind: 'agent',
        status: 'success',
        title: `Agent done | ${model}${depth > 0 ? ` | depth ${depth}` : ''}`,
        detail: [
          summarizeAgentDescription(description),
          response.trim() ? `Response: ${truncateForActivity(response, 1000)}` : '',
        ].filter(Boolean).join('\n\n'),
      });
    });

    const syncMcpConnected = bus.on('mcp:server-connected', ({ serverName, tools }) => {
      appendActivityEntry({
        id: `mcp-connected-${Date.now()}-${serverName}`,
        createdAt: Date.now(),
        kind: 'mcp',
        status: 'success',
        title: `MCP connected | ${serverName}`,
        detail: `${tools.length} tool${tools.length === 1 ? '' : 's'} available`,
      });
    });

    const syncMcpDisconnected = bus.on('mcp:server-disconnected', ({ serverName }) => {
      appendActivityEntry({
        id: `mcp-disconnected-${Date.now()}-${serverName}`,
        createdAt: Date.now(),
        kind: 'mcp',
        status: 'neutral',
        title: `MCP disconnected | ${serverName}`,
      });
    });

    const syncMcpError = bus.on('mcp:server-error', ({ serverName, error }) => {
      appendActivityEntry({
        id: `mcp-error-${Date.now()}-${serverName}`,
        createdAt: Date.now(),
        kind: 'mcp',
        status: 'error',
        title: `MCP error | ${serverName}`,
        detail: error,
      });
    });

    return () => {
      syncToolCall();
      syncToolResult();
      syncConfigReload();
      syncSessionMessage();
      syncAgentStart();
      syncAgentDone();
      syncMcpConnected();
      syncMcpDisconnected();
      syncMcpError();
    };
  }, [appendActivityEntry, updateActivityEntry]);

  useEffect(() => {
    return bus.on('context:usage', ({ inputTokens, model }) => {
      setContextUsage({ inputTokens, model });
    });
  }, []);

  useBracketedPaste((content) => {
    setQuestionInput((current) => current + content);
  }, { isActive: Boolean(pendingQuestion) });

  useEffect(() => {
    const syncMcpCount = () => {
      setMcpConnectedCount(
        iris.mcpRegistry.getServerStates().filter((state) => state.status === 'connected').length,
      );
    };

    syncMcpCount();
    const offConnected = bus.on('mcp:server-connected', syncMcpCount);
    const offDisconnected = bus.on('mcp:server-disconnected', syncMcpCount);
    const offError = bus.on('mcp:server-error', syncMcpCount);

    return () => {
      offConnected();
      offDisconnected();
      offError();
    };
  }, [iris.mcpRegistry]);

  useEffect(() => {
    let cancelled = false;

    async function loadSlashCommands() {
      if (!iris.sessionRef.current) {
        return;
      }
      const registry = createCommandRegistry({
        args: [],
        session: iris.sessionRef.current,
        config,
        engine: iris.permissionEngineRef.current,
        cwd,
        mcpRegistry: iris.mcpRegistry,
        skillResult: iris.skillResult,
        hookRegistry: iris.hookRegistry,
        pluginResult: iris.pluginResult,
      });
      const customCommands = await loadCustomCommands(cwd);
      for (const entry of customCommands) {
        registry.registerCustom(entry);
      }
      for (const plugin of iris.pluginResult.plugins) {
        await activatePlugin(plugin, registry, iris.skillResult, iris.hookRegistry, iris.mcpRegistry, cwd);
      }
      registerSkillCommands(registry, iris.skillResult);
      if (!cancelled) {
        iris.commandRegistryRef.current = registry;
        setCommandRegistry(registry);
      }
    }

    void loadSlashCommands();
    return () => {
      cancelled = true;
    };
  }, [config, cwd, iris.commandRegistryRef, iris.permissionEngineRef, iris.sessionRef]);

  const writeSystemMessage = useCallback((text: string) => {
    appendActivityEntry({
      id: `activity-info-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      kind: 'info',
      status: 'neutral',
      title: truncateForActivity(text, 160),
      detail: text.length > 160 ? text : undefined,
    });
    setMessages((current) => [
      ...current,
      {
        id: `system-${Date.now()}-${current.length}`,
        kind: 'system',
        role: 'system',
        text,
        createdAt: Date.now(),
        complete: true,
      },
    ]);
  }, [appendActivityEntry]);

  const writeErrorMessage = useCallback((text: string) => {
    appendActivityEntry({
      id: `activity-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      kind: 'error',
      status: 'error',
      title: truncateForActivity(text, 160),
      detail: text.length > 160 ? text : undefined,
    });
    setMessages((current) => [
      ...current,
      {
        id: `system-${Date.now()}-${current.length}`,
        kind: 'system',
        role: 'system',
        text: `Error: ${text}`,
        createdAt: Date.now(),
        complete: true,
      },
    ]);
  }, [appendActivityEntry]);

  const askUser = useCallback(async (question: string): Promise<string> => {
    return new Promise<string>((resolve) => {
      pendingQuestionResolverRef.current = resolve;
      setQuestionInput('');
      setPendingQuestion(question);
    });
  }, []);

  const requestPermission = useCallback(async (
    request: PermissionRequest,
    result: PermissionResult,
    tool?: ToolDefinitionSchema,
  ): Promise<ToolPermissionChoice> => {
    notifierRef.current.notifyPermissionPrompt();
    return new Promise<ToolPermissionChoice>((resolve) => {
      setPendingPermission({ request, result, tool, resolve });
    });
  }, []);

  const updateStreamingMessage = useCallback((chunk: string) => {
    streamBufferRef.current += chunk;
    if (streamIntervalRef.current) {
      return;
    }

    streamIntervalRef.current = setInterval(() => {
      const buffered = streamBufferRef.current;
      if (!buffered) {
        return;
      }
      streamBufferRef.current = '';
      setMessages((current) => {
        const last = current.at(-1);
        if (last?.kind === 'assistant-text' && !last.complete) {
          return [
            ...current.slice(0, -1),
            {
              ...last,
              text: `${last.text}${buffered}`,
            },
          ];
        }
        return [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            kind: 'assistant-text',
            role: 'assistant',
            text: buffered,
            createdAt: Date.now(),
            complete: false,
            isStreaming: true,
          },
        ];
      });
    }, 1000 / 60);
    streamIntervalRef.current.unref?.();
  }, []);

  const finalizeStreamingMessage = useCallback((fallbackText: string) => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    const buffered = streamBufferRef.current;
    streamBufferRef.current = '';
    setMessages((current) => {
      // Find the last incomplete assistant-text message (may not be current.at(-1) if
      // tool-call messages were inserted after it during a multi-turn run).
      let lastIncompleteIdx = -1;
      for (let i = current.length - 1; i >= 0; i--) {
        if (current[i].kind === 'assistant-text' && !current[i].complete) {
          lastIncompleteIdx = i;
          break;
        }
      }

      if (lastIncompleteIdx === -1) {
        return [
          ...current,
          {
            id: `assistant-final-${Date.now()}`,
            kind: 'assistant-text',
            role: 'assistant',
            text: buffered || fallbackText || '(no response)',
            createdAt: Date.now(),
            complete: true,
            isStreaming: false,
          },
        ];
      }

      // Finalize all incomplete assistant-text messages. The last one receives
      // the remaining buffer + fallback; earlier orphans are finalized as-is
      // (or removed if they are empty).
      return current.flatMap((m, idx) => {
        if (m.kind !== 'assistant-text' || m.complete) {
          return [m];
        }
        if (idx === lastIncompleteIdx) {
          return [{ ...m, text: `${m.text}${buffered || ''}` || fallbackText, complete: true, isStreaming: false }];
        }
        // Earlier orphan incomplete message: keep if it has text, drop if empty.
        return m.text ? [{ ...m, complete: true, isStreaming: false }] : [];
      });
    });
  }, []);

  const finalizeCancelledStreamingMessage = useCallback(() => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    const buffered = streamBufferRef.current;
    streamBufferRef.current = '';
    setMessages((current) => {
      // Finalize all incomplete assistant-text messages (not just the last, since
      // tool-call messages may have been inserted after earlier streaming messages).
      const hasIncomplete = current.some((m) => m.kind === 'assistant-text' && !m.complete);
      if (!hasIncomplete) {
        return current;
      }
      let lastIncompleteIdx = -1;
      for (let i = current.length - 1; i >= 0; i--) {
        if (current[i].kind === 'assistant-text' && !current[i].complete) {
          lastIncompleteIdx = i;
          break;
        }
      }
      return current.flatMap((m, idx) => {
        if (m.kind !== 'assistant-text' || m.complete) {
          return [m];
        }
        if (idx === lastIncompleteIdx) {
          const text = `${m.text}${buffered || ''}`.trimEnd();
          return text ? [{ ...m, text, complete: true, isStreaming: false }] : [];
        }
        // Earlier orphan incomplete message.
        return m.text ? [{ ...m, complete: true, isStreaming: false }] : [];
      });
    });
  }, []);

  const refreshContext = useCallback(async () => {
    const nextConfig = await reloadConfig(cwd);
    const nextMemoryFiles = await loadContextFilesForSession(cwd);
    setConfig(nextConfig);
    setMemoryFiles(nextMemoryFiles);
  }, [cwd]);

  const executeDetachedPrompt = useCallback(async (text: string, options: { allowedTools?: string[]; model?: string; systemPrompt?: string }): Promise<string> => {
    const modelKey = normalizeModelKey(options.model ?? activeModel);
    const modelRegistry = await createModelRegistry(config);
    const adapter = modelRegistry.get(modelKey);
    const detachedHistory: Message[] = [{ role: 'user', content: text }];
    const detachedSession = createHeadlessSession({
      cwd,
      config,
      permissionEngine: iris.permissionEngineRef.current,
      model: modelKey,
      mcpRegistry: iris.mcpRegistry,
    });
    detachedSession.messages = detachedHistory;
    const tools = createToolRegistry({
      currentModel: modelKey,
      allowedTools: options.allowedTools,
      orchestrator: iris.sessionRef.current?.orchestrator,
      tracker: iris.graphTrackerRef.current ?? undefined,
      agentId: 'root',
      depth: 0,
      diffInterceptor: iris.diffInterceptorRef.current,
      mcpRegistry: iris.mcpRegistry,
      permissionEngine: iris.permissionEngineRef.current,
      skillResult: iris.skillResult,
      session: detachedSession,
    });
    const result = await runAgentLoop(detachedHistory, {
      adapter,
      tools,
      permissions: iris.permissionEngineRef.current,
      modelRegistry,
      systemPrompt: options.systemPrompt ?? appendContextText(
        buildDefaultSystemPrompt(true, tools.getDefinitions().map((tool) => tool.name)),
        config.context_text,
      ),
      cwd,
      sessionId: iris.runtime.sessionIdRef.current,
      costTracker: iris.sessionRef.current?.costTracker,
      orchestrator: iris.sessionRef.current?.orchestrator,
      tracker: iris.graphTrackerRef.current ?? undefined,
      agentId: 'root',
      depth: 0,
      description: text,
      hookRegistry: iris.hookRegistry,
      session: detachedSession,
    });
    return result.finalText;
  }, [activeModel, config, cwd, iris]);

  if (!iris.sessionRef.current) {
    const session = new Session({
      cwd,
      config,
      permissionEngine: iris.permissionEngineRef.current,
      model: activeModel,
      permissionMode: activeMode,
      memoryFiles,
      diffStore: diffStoreRef.current,
      mcpRegistry: iris.mcpRegistry,
      hooks: {
        onClear: () => {
          setMessages([]);
          historyRef.current = [];
          setActivityEntries([]);
          setContextUsage(null);
          setPaletteEntries([]);
          setPaletteSelectedIndex(0);
          streamBufferRef.current = '';
          if (streamIntervalRef.current) {
            clearInterval(streamIntervalRef.current);
            streamIntervalRef.current = null;
          }
          setTranscriptResetVersion((current) => current + 1);
          process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
        },
        onCompact: () => writeSystemMessage('Compacted. Context window refreshed.'),
        onRunPrompt: async (request) => {
          await handleSubmit(request.text, request.allowedTools, request.model, request.displayAssistantResponse !== false);
        },
        onExecutePrompt: async (request) => executeDetachedPrompt(request.text, request),
        onInfo: writeSystemMessage,
        onError: writeErrorMessage,
        onShowCommand: (text) => {
          const nextMessage: IrisMessage = {
            id: `user-command-${Date.now()}`,
            kind: 'user-text',
            role: 'user',
            text,
            createdAt: Date.now(),
            complete: true,
          };
          setMessages((current) => current.length === 0 ? [nextMessage] : [...current, nextMessage]);
        },
        onResumeUi: () => {
          setTranscriptResetVersion((current) => current + 1);
        },
        onAsk: askUser,
        onGetToolDefinitions: (allowedTools) =>
          createToolRegistry({
            currentModel: activeModel,
            allowedTools,
            orchestrator: iris.sessionRef.current?.orchestrator,
            tracker: iris.graphTrackerRef.current ?? undefined,
            agentId: 'root',
            depth: 0,
            diffInterceptor: iris.diffInterceptorRef.current,
            mcpRegistry: iris.mcpRegistry,
            permissionEngine: iris.permissionEngineRef.current,
            skillResult: iris.skillResult,
            session: iris.sessionRef.current ?? undefined,
          }).getDefinitions(),
        onViewDiff: async (diff, options) => {
          if (options?.readOnly) {
            return diffControllerRef.current.showReadOnly(diff);
          }
          return diffControllerRef.current.show(diff, Boolean(options?.autoAccept));
        },
        onOpenModelPicker: async () => {
          const registry = await createModelRegistry(config);
          return new Promise<string | undefined>((resolve) => {
            setOverlay({ kind: 'model-picker', availableModels: registry.keys(), resolve });
          });
        },
        onOpenSessionPicker: async (sessions) =>
          new Promise<SessionSnapshotSummary | undefined>((resolve) => {
            setOverlay({ kind: 'session-picker', sessions, resolve });
          }),
        onOpenMemoryMenu: async () =>
          new Promise<import('../commands/types.ts').MemoryMenuAction | undefined>((resolve) => {
            setOverlay({ kind: 'memory-menu', resolve });
          }),
        onOpenMcpMenu: async () =>
          new Promise<McpMenuAction | undefined>((resolve) => {
            setOverlay({
              kind: 'picker',
              title: 'MCP',
              options: [
                { label: 'List servers', value: 'list-servers', description: 'Show configured servers and status' },
                { label: 'Show tools', value: 'show-tools', description: 'List all connected MCP tools' },
                { label: 'Reconnect server', value: 'reconnect', description: 'Reconnect a configured server' },
                { label: 'Login server', value: 'login', description: 'Run OAuth login for an HTTP server' },
                { label: 'Add server', value: 'add-server', description: 'Append a server to ~/.iris/config.toml' },
                { label: 'Remove server', value: 'remove-server', description: 'Remove a configured server' },
              ],
              resolve: (value) => resolve(value as McpMenuAction | undefined),
            });
          }),
        onOpenPicker: async (options, title) =>
          new Promise<string | undefined>((resolve) => {
            setOverlay({
              kind: 'picker',
              title: title ?? 'Select item',
              options,
              resolve,
            });
          }),
        onRefreshContext: refreshContext,
        onSetModel: (model) => setActiveModel(normalizeModelKey(model)),
        onSetMode: (mode) => setActiveMode(mode),
      },
    });
    iris.sessionRef.current = session;
    iris.graphTrackerRef.current = session.graphTracker;
    iris.runtime.sessionIdRef.current = session.id;
    void runEventHooks('session:start', {
      event: 'session:start',
      timing: 'pre',
      sessionId: session.id,
    }, iris.hookRegistry);
  }

  const handleSubmit = useCallback(async (
    value: string,
    allowedTools?: string[],
    modelOverrideForPrompt?: string,
    displayAssistantResponse = true,
  ) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    diffControllerRef.current.reset();
    const runId = activeRunIdRef.current + 1;
    activeRunIdRef.current = runId;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setRunning(true);
    setStreaming(true);
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        kind: 'user-text',
        role: 'user',
        text: trimmed,
        createdAt: Date.now(),
        complete: true,
      },
      {
        id: `assistant-stream-${Date.now()}`,
        kind: 'assistant-text',
        role: 'assistant',
        text: '',
        createdAt: Date.now(),
        complete: false,
        isStreaming: true,
      },
    ]);

    historyRef.current.push({ role: 'user', content: trimmed });
    iris.sessionRef.current!.messages = historyRef.current;

    try {
      const modelKey = normalizeModelKey(
        modelOverrideForPrompt
          ?? iris.sessionRef.current?.consumeNextPromptModelOverride?.()
          ?? activeModel,
      );
      const modelRegistry = await createModelRegistry(config);
      modelRegistryRef.current = modelRegistry;
      if (!compactionManagerRef.current && iris.sessionRef.current) {
        const cm = new CompactionManager(iris.sessionRef.current, modelRegistry);
        cm.start();
        compactionManagerRef.current = cm;
        onCompactionManagerReady?.(cm, modelRegistry);
      }
      const adapter = modelRegistry.get(modelKey);
      iris.sessionRef.current!.prepareRun(trimmed);
      iris.graphTrackerRef.current = iris.sessionRef.current!.graphTracker;
      iris.permissionEngineRef.current.setMode(activeMode);
      iris.diffInterceptorRef.current.setMode(activeMode);
      iris.sessionRef.current!.orchestrator.updateRuntime({
        currentModel: modelKey,
        loadedSkills: loadedSkillsRef.current,
        askUser,
        onInfo: writeSystemMessage,
        onPermissionPrompt: requestPermission,
        diffInterceptor: iris.diffInterceptorRef.current,
        mcpRegistry: iris.mcpRegistry,
        hookRegistry: iris.hookRegistry,
        skillResult: iris.skillResult,
      });

      const tools = createToolRegistry({
        currentModel: modelKey,
        allowedTools,
        orchestrator: iris.sessionRef.current!.orchestrator,
        tracker: iris.graphTrackerRef.current ?? undefined,
        agentId: 'root',
        depth: 0,
        diffInterceptor: iris.diffInterceptorRef.current,
        mcpRegistry: iris.mcpRegistry,
        permissionEngine: iris.permissionEngineRef.current,
        skillResult: iris.skillResult,
        session: iris.sessionRef.current!,
      });
      const baseSystemPrompt = appendContextText(
        buildDefaultSystemPrompt(true, tools.getDefinitions().map((tool) => tool.name)),
        config.context_text,
      );

      const result = await runAgentLoop(historyRef.current, {
        adapter,
        tools,
        permissions: iris.permissionEngineRef.current,
        modelRegistry,
        systemPrompt: baseSystemPrompt,
        cwd,
        sessionId: iris.sessionRef.current!.id,
        costTracker: iris.sessionRef.current!.costTracker,
        loadedSkills: loadedSkillsRef.current,
        orchestrator: iris.sessionRef.current!.orchestrator,
        tracker: iris.graphTrackerRef.current ?? undefined,
        agentId: 'root',
        parentAgentId: null,
        depth: 0,
        description: trimmed,
        askUser,
        onText: updateStreamingMessage,
        onInfo: writeSystemMessage,
        onPermissionPrompt: requestPermission,
        abortSignal: abortController.signal,
        hookRegistry: iris.hookRegistry,
        session: iris.sessionRef.current!,
      });

      if (activeRunIdRef.current !== runId) {
        return;
      }

      totalInputTokensRef.current += result.totalInputTokens;
      totalOutputTokensRef.current += result.totalOutputTokens;
      iris.sessionRef.current!.totalInputTokens = totalInputTokensRef.current;
      iris.sessionRef.current!.totalOutputTokens = totalOutputTokensRef.current;
      sessionCostRef.current = iris.sessionRef.current!.costTracker.total().costUsd;

      if (displayAssistantResponse) {
        finalizeStreamingMessage(result.finalText || '(no response)');
      } else {
        setMessages((current) => current.filter((message) => message.kind !== 'assistant-text' || message.text.length > 0));
      }

      await iris.sessionRef.current!.save();
      notifierRef.current.notifyTurnComplete('Agent turn complete');
    } catch (error) {
      if (activeRunIdRef.current !== runId) {
        return;
      }
      if (isAbortError(error) || abortController.signal.aborted) {
        finalizeCancelledStreamingMessage();
        writeSystemMessage('Cancelled.');
      } else {
        finalizeStreamingMessage('');
        writeErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (activeRunIdRef.current === runId) {
        abortControllerRef.current = null;
        setStreaming(false);
        setRunning(false);
        setPendingPermission(null);
        pendingQuestionResolverRef.current = null;
        setPendingQuestion(null);
        setQuestionInput('');
      }
    }
  }, [activeMode, activeModel, askUser, config, cwd, finalizeCancelledStreamingMessage, finalizeStreamingMessage, iris, requestPermission, updateStreamingMessage, writeErrorMessage, writeSystemMessage]);

  iris.runtime.sendMessageRef.current = async (text: string) => {
    await handleSubmit(text);
  };
  iris.runtime.sendCommandRef.current = async (text: string) => {
    if (!commandRegistry || !iris.sessionRef.current) {
      return 'passthrough';
    }
    return handleInput(text, {
      args: [],
      session: iris.sessionRef.current,
      config,
      engine: iris.permissionEngineRef.current,
      cwd,
      registry: commandRegistry,
      compactionManager: compactionManagerRef.current ?? undefined,
      modelRegistry: modelRegistryRef.current ?? undefined,
      mcpRegistry: iris.mcpRegistry,
      skillResult: iris.skillResult,
      hookRegistry: iris.hookRegistry,
      pluginResult: iris.pluginResult,
    });
  };
  iris.runtime.cancelRef.current = () => {
    const controller = abortControllerRef.current;
    if (!controller || controller.signal.aborted) {
      return;
    }
    controller.abort();
    finalizeCancelledStreamingMessage();
    setStreaming(false);
    setRunning(false);
  };

  const handleCycleMode = useCallback(() => {
    const cycle: PermissionMode[] = ['default', 'acceptEdits', 'plan'];
    const next = cycle[(cycle.indexOf(activeMode) + 1) % cycle.length];
    setActiveMode(next);
    iris.permissionEngineRef.current.setMode(next);
    iris.sessionRef.current?.setMode(next);
  }, [activeMode, iris]);

  const headerRows = useMemo(
    () => [
      {
        key: 'header-logo',
        jsx: (
          <Box key="header-logo" flexDirection="row" marginBottom={1}>
            <Box flexDirection="column" marginRight={2}>
              <Text color={theme.colors.brand}>{'▛▀▜'}</Text>
              <Text color={theme.colors.brand}>{'▌▐▐'}</Text>
              <Text color={theme.colors.brand}>{'▝ ▝'}</Text>
            </Box>
            <Box flexDirection="column">
              <Box>
                <Text bold>{'IrisCode'}</Text>
                <Text color={theme.colors.muted}>{' v0.1.0'}</Text>
              </Box>
              <Text color={theme.colors.muted}>{`${friendlyModelLabel(activeModel)} · ${providerLabel}`}</Text>
              <Text color={theme.colors.muted}>{compactPath}</Text>
            </Box>
          </Box>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const messageRows = useMemo(
    () =>
      messages
        .filter((message) => !('isMeta' in message) || message.isMeta !== true)
        .map((message) => ({
        key: message.id,
        type: message.complete ? 'static' : 'transient',
        jsx: <RenderMessage key={message.id} message={message} />,
        })),
    [messages],
  );

  const staticItems = useMemo(
    () => [...headerRows, ...messageRows.filter((m) => m.type === 'static')],
    [headerRows, messageRows],
  );

  const paletteVisible = !pendingPermission && !pendingDiff && !overlay && paletteEntries.length > 0 && !running;

  useInput((input, key) => {
    if (promptIsActive) {
      return;
    }
    if (key.ctrl && input === 'o') {
      toggleActivity();
    }
  }, { isActive: !promptIsActive });

  return (
    <Box flexDirection="column" height="100%" paddingX={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Static key={`transcript-${transcriptResetVersion}`} items={staticItems}>
          {(item) => item.jsx}
        </Static>

        {messageRows.filter((message) => message.type === 'transient').map((item) => item.jsx)}
      </Box>

      {pendingPermission ? (
        <PermissionPrompt
          request={pendingPermission.request}
          tool={pendingPermission.tool}
          onSelect={(choice) => {
            pendingPermission.resolve(choice);
            setPendingPermission(null);
          }}
        />
      ) : pendingDiff ? (
        <DiffViewer
          result={pendingDiff.result}
          mode="sideBySide"
          readOnly={pendingDiff.kind === 'readonly'}
          autoAccept={pendingDiff.kind === 'interactive' ? pendingDiff.autoAccept : false}
          onAccept={() => {
            if (pendingDiff.kind === 'interactive') {
              pendingDiff.resolve('accepted');
            } else {
              pendingDiff.resolve();
            }
            setPendingDiff(null);
          }}
          onReject={() => {
            if (pendingDiff.kind === 'interactive') {
              pendingDiff.resolve('rejected');
            } else {
              pendingDiff.resolve();
            }
            setPendingDiff(null);
          }}
          onAcceptAll={() => {
            if (pendingDiff.kind === 'interactive') {
              pendingDiff.acceptAll();
            }
          }}
          onClose={() => {
            if (pendingDiff.kind === 'readonly') {
              pendingDiff.resolve();
            }
            setPendingDiff(null);
          }}
        />
      ) : running ? (
        <TaskGraph />
      ) : null}

      {pendingQuestion ? (
        <Box flexDirection="column">
          <Text color={theme.colors.warning}>{pendingQuestion}</Text>
          <TextInput
            value={questionInput}
            onChange={setQuestionInput}
            onSubmit={(value) => {
              pendingQuestionResolverRef.current?.(value);
              setPendingQuestion(null);
              setQuestionInput('');
            }}
          />
        </Box>
      ) : null}

      {overlay?.kind === 'model-picker' ? (
        <ModelPicker
          currentModel={activeModel}
          availableModels={overlay.availableModels}
          config={config}
          onCancel={() => {
            overlay.resolve(undefined);
            setOverlay(null);
          }}
          onSelect={(model) => {
            overlay.resolve(model);
            setActiveModel(model);
            setOverlay(null);
          }}
          onConfigureProvider={async (provider, key) => {
            await setApiKey(provider, key);
            const nextConfig = await reloadConfig(cwd);
            setConfig(nextConfig);
          }}
        />
      ) : null}

      {overlay?.kind === 'session-picker' ? (
        <SessionPicker
          sessions={overlay.sessions}
          onCancel={() => {
            overlay.resolve(undefined);
            setOverlay(null);
          }}
          onSelect={(session) => {
            overlay.resolve(session);
            setOverlay(null);
          }}
        />
      ) : null}

      {overlay?.kind === 'memory-menu' ? (
        <MemoryMenuPicker
          onCancel={() => {
            overlay.resolve(undefined);
            setOverlay(null);
          }}
          onSelect={(action) => {
            overlay.resolve(action);
            setOverlay(null);
          }}
        />
      ) : null}

      {overlay?.kind === 'picker' ? (
        <ListPicker
          title={overlay.title}
          options={overlay.options}
          onCancel={() => {
            overlay.resolve(undefined);
            setOverlay(null);
          }}
          onSelect={(value) => {
            overlay.resolve(value);
            setOverlay(null);
          }}
        />
      ) : null}

      <Text color={theme.colors.dim}>{divider}</Text>

      {showActivity ? <ActivityPanel entries={activityEntries} maxVisible={Math.max(6, Math.floor(columns / 12))} /> : null}

      {paletteVisible ? (
        <CommandPalette
          query=""
          entries={paletteEntries.slice(0, 8)}
          selectedIndex={Math.min(paletteSelectedIndex, Math.max(paletteEntries.length - 1, 0))}
        />
      ) : null}

      <PromptInput
        history={commandHistory}
        registry={commandRegistry}
        isDisabled={running}
        isActive={promptIsActive}
        canCancelWithEscape={running && promptIsActive}
        canExitWithEscape={!running && promptIsActive}
        placeholder=""
        onSubmit={async (value) => {
          const result = commandRegistry
            ? await handleInput(value, {
                args: [],
                session: iris.sessionRef.current!,
                config,
              engine: iris.permissionEngineRef.current,
              cwd,
              registry: commandRegistry,
              compactionManager: compactionManagerRef.current ?? undefined,
              modelRegistry: modelRegistryRef.current ?? undefined,
              mcpRegistry: iris.mcpRegistry,
              skillResult: iris.skillResult,
              hookRegistry: iris.hookRegistry,
              pluginResult: iris.pluginResult,
            })
            : 'passthrough';

          if (result === 'passthrough') {
            await handleSubmit(value);
          } else {
            await iris.sessionRef.current?.save();
          }
        }}
        onCycleMode={handleCycleMode}
        onOpenMcp={async () => {
          await iris.runtime.sendCommandRef.current('/mcp');
        }}
        onToggleActivity={toggleActivity}
        onSuggestionsChange={({ suggestions, selectedIndex }) => {
          setPaletteEntries(suggestions);
          setPaletteSelectedIndex(selectedIndex);
        }}
      />

      <Text color={theme.colors.dim}>{divider}</Text>

      <CostBar
        model={activeModel}
        mode={activeMode}
        memoryTokens={estimateContextTokens(config.context_text)}
        memoryMaxTokens={config.memory.max_tokens}
        sessionId={iris.runtime.sessionIdRef.current}
        projectName={projectName}
        mcpServerCount={mcpConnectedCount}
      />
      <ContextBar contextUsage={contextUsage} columns={columns} />
      <Box>
        <Text color="magenta">{'►► '}</Text>
        <Text color={theme.colors.muted}>{modeLabel(activeMode)}</Text>
        <Text color={theme.colors.dim}>{` (shift+tab to cycle, ctrl+g for /mcp, ctrl+o ${showActivity ? 'to collapse activity' : 'for activity'})`}</Text>
      </Box>
    </Box>
  );
}

function MemoryMenuPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (action: import('../commands/types.ts').MemoryMenuAction) => void;
  onCancel: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items = [
    { label: 'Clear project memory', value: 'clear-project' as import('../commands/types.ts').MemoryMenuAction },
    { label: 'Clear global memory', value: 'clear-global' as import('../commands/types.ts').MemoryMenuAction },
    { label: 'Edit project IRIS.md', value: 'edit-project' as import('../commands/types.ts').MemoryMenuAction },
    { label: 'Edit global IRIS.md', value: 'edit-global' as import('../commands/types.ts').MemoryMenuAction },
  ];

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((current) => (current + items.length - 1) % items.length);
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((current) => (current + 1) % items.length);
      return;
    }
    if (key.return) {
      const item = items[selectedIndex];
      if (item) {
        onSelect(item.value);
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Text bold>Memory actions</Text>
      {items.map((item, index) => (
        <Text key={item.value} color={index === selectedIndex ? 'cyan' : undefined}>
          {`${index === selectedIndex ? '›' : ' '} ${item.label}`}
        </Text>
      ))}
      <Text color="gray">Use arrows and Enter to select. Esc cancels.</Text>
    </Box>
  );
}

function ListPicker({
  title,
  options,
  onSelect,
  onCancel,
}: {
  title: string;
  options: PickerOption[];
  onSelect: (value: string) => void;
  onCancel: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((current) => (current + options.length - 1) % Math.max(options.length, 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((current) => (current + 1) % Math.max(options.length, 1));
      return;
    }
    if (key.return) {
      const option = options[selectedIndex];
      if (option) {
        onSelect(option.value);
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.colors.accent} paddingX={1} marginBottom={1}>
      <Text bold>{title}</Text>
      {options.length === 0 ? (
        <Text color={theme.colors.dim}>No items available.</Text>
      ) : options.map((option, index) => (
        <Box key={option.value} flexDirection="column">
          <Text color={index === selectedIndex ? theme.colors.accent : undefined}>
            {`${index === selectedIndex ? '›' : ' '} ${option.label}`}
          </Text>
          {option.description ? <Text color={theme.colors.dim}>{`   ${option.description}`}</Text> : null}
        </Box>
      ))}
      <Text color={theme.colors.dim}>Use arrows and Enter to select. Esc cancels.</Text>
    </Box>
  );
}

function RenderMessage({ message }: { message: IrisMessage }) {
  if (message.kind === 'user-text') {
    return <UserTextMessage message={message} />;
  }
  if (message.kind === 'assistant-text') {
    return <AssistantTextMessage message={message} />;
  }
  if (message.kind === 'assistant-tool-use') {
    return <AssistantToolUseMessage message={message} />;
  }
  return <Text color={theme.colors.dim}>{message.text}</Text>;
}

function toDisplayMessages(messages: IrisMessage[]) {
  return messages
    .filter((message) => message.kind !== 'assistant-tool-use')
    .filter((message) => !('isMeta' in message) || message.isMeta !== true)
    .map((message) => ({
      role: message.role,
      text: message.text,
    }));
}

async function loadContextFilesForSession(cwd: string): Promise<LoadedMemoryFile[]> {
  const [globalInput, projectInput] = await Promise.all([
    loadGlobalConfig(),
    loadProjectConfig(cwd),
  ]);

  return [...globalInput.contextFiles, ...projectInput.contextFiles].map((file) => ({
    path: file.path,
    lineCount: file.lineCount,
    tokenCount: file.tokenCount,
    preview: file.text.split('\n').slice(0, 3).join('\n'),
  }));
}

function normalizeModelKey(model: string): string {
  const { provider, modelId } = parseModelString(model);
  return `${provider}/${modelId}`;
}

function formatToolActivityDetail(name: string, input: Record<string, unknown>): string {
  if (name === 'bash' && typeof input.command === 'string') {
    return `Command: ${input.command}`;
  }

  if (name.includes(':') && Object.keys(input).length > 0) {
    return `Input: ${truncateForActivity(JSON.stringify(input, null, 2), 800)}`;
  }

  if (Object.keys(input).length === 0) {
    return 'Input: {}';
  }

  return `Input: ${truncateForActivity(JSON.stringify(input, null, 2), 800)}`;
}

function summarizeAgentDescription(description: string): string {
  return truncateForActivity(
    description
      .replace(/\s+/g, ' ')
      .trim(),
    220,
  );
}

function truncateForActivity(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function estimateContextTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

function abbreviatePath(path: string): string {
  const home = process.env.HOME;
  if (home && path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

function friendlyModelLabel(model: string): string {
  return model.replace(/^anthropic\//, '').replace(/^openai\//, '').replace(/^ollama\//, '');
}

function modeLabel(mode: PermissionMode): string {
  switch (mode) {
    case 'default': return 'normal mode';
    case 'acceptEdits': return 'accept edits on';
    case 'plan': return 'plan mode';
  }
}

// Known context window sizes (in tokens) per model ID.
const CONTEXT_WINDOW_SIZES: Record<string, number> = {
  // Anthropic
  'claude-opus-4-6':   200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5':  200_000,
  // OpenAI
  'gpt-4o':            128_000,
  'gpt-4o-mini':       128_000,
  'gpt-4-turbo':       128_000,
  'o1':                128_000,
  'o3-mini':           128_000,
  // Google
  'gemini-2.5-pro':    1_048_576,
  'gemini-2.5-flash':  1_048_576,
  'gemini-2.0-flash':  1_048_576,
  // Groq / Meta
  'llama-3.3-70b-versatile': 128_000,
  'llama-3.1-8b-instant':    128_000,
  // Mistral
  'mistral-large-latest': 128_000,
  'mistral-small-latest': 128_000,
  'codestral-latest':     256_000,
  // DeepSeek
  'deepseek-chat':     64_000,
  'deepseek-reasoner': 64_000,
  // xAI
  'grok-3':     131_072,
  'grok-3-mini': 131_072,
  'grok-2':     131_072,
  // Mixtral
  'mixtral-8x7b-32768': 32_768,
  // Cohere
  'command-r-plus': 128_000,
  'command-r':      128_000,
};

function getContextWindowSize(modelKey: string): number {
  // modelKey is like "anthropic/claude-sonnet-4-6"
  const modelId = modelKey.includes('/') ? modelKey.split('/').slice(1).join('/') : modelKey;
  return CONTEXT_WINDOW_SIZES[modelId] ?? 128_000;
}

function ContextBar({
  contextUsage,
  columns,
}: {
  contextUsage: { inputTokens: number; model: string } | null;
  columns: number;
}) {
  if (!contextUsage || contextUsage.inputTokens === 0) {
    return null;
  }

  const windowSize = getContextWindowSize(contextUsage.model);
  const ratio = Math.min(1, contextUsage.inputTokens / windowSize);
  const pct = Math.round(ratio * 100);

  const pctLabel = `${pct}%`;
  const barWidth = 9;
  const filled = Math.round(ratio * barWidth);
  const empty = barWidth - filled;

  const filledBar = '█'.repeat(filled);
  const emptyBar = '░'.repeat(empty);

  const activeColor =
    ratio >= 0.9
      ? theme.colors.error
      : ratio >= 0.75
        ? theme.colors.warning
        : theme.colors.success;

  return (
    <Box>
      <Text color={activeColor}>{filledBar}</Text>
      <Text color={activeColor}>{emptyBar}</Text>
      <Text color={theme.colors.dim}>{`  ${pctLabel}`}</Text>
    </Box>
  );
}
