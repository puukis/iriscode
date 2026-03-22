import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { runAgentLoop, type ToolPermissionChoice } from '../agent/loop.ts';
import { Session } from '../agent/session.ts';
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
import type { LoadedMemoryFile, SessionSnapshotSummary } from '../commands/types.ts';
import { handleInput } from '../cli/input-handler.ts';
import { PermissionPrompt } from '../ui/components/permission-prompt.tsx';
import { DiffViewer } from '../ui/components/diff-viewer.tsx';
import { ModelPicker } from '../ui/components/model-picker.tsx';
import { SessionPicker } from '../ui/components/session-picker.tsx';
import { TaskGraph } from '../ui/components/task-graph.tsx';
import { CommandPalette } from '../ui/components/command-palette.tsx';
import { PromptInput } from '../ui/components/prompt-input.tsx';
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
import {
  createDefaultRegistry as createToolRegistry,
  type LoadedSkill,
} from '../tools/index.ts';
import { logger } from '../shared/logger.ts';

interface REPLProps {
  cwd: string;
  initialConfig: Awaited<ReturnType<typeof reloadConfig>>;
  initialMemoryFiles: LoadedMemoryFile[];
  modelOverride?: string;
  modeOverride?: PermissionMode;
}

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
    };

export function REPL({
  cwd,
  initialConfig,
  initialMemoryFiles,
  modelOverride,
  modeOverride,
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
  const commandHistory = useMemo(
    () => messages.filter((message) => message.kind === 'user-text').map((message) => message.text),
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
    });

    const syncConfigReload = bus.on('config:reloaded', ({ config: nextConfig }) => {
      setConfig(nextConfig);
    });

    return () => {
      syncToolCall();
      syncToolResult();
      syncConfigReload();
    };
  }, []);

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
      });
      const customCommands = await loadCustomCommands(cwd);
      for (const entry of customCommands) {
        registry.registerCustom(entry);
      }
      await registerSkillCommands(registry, cwd);
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
  }, []);

  const writeErrorMessage = useCallback((text: string) => {
    writeSystemMessage(`Error: ${text}`);
  }, [writeSystemMessage]);

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
      const last = current.at(-1);
      if (last?.kind === 'assistant-text' && !last.complete) {
        return [
          ...current.slice(0, -1),
          {
            ...last,
            text: `${last.text}${buffered || ''}` || fallbackText,
            complete: true,
            isStreaming: false,
          },
        ];
      }
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
      const last = current.at(-1);
      if (last?.kind !== 'assistant-text' || last.complete) {
        return current;
      }
      const text = `${last.text}${buffered || ''}`.trimEnd();
      if (!text) {
        return current.slice(0, -1);
      }
      return [
        ...current.slice(0, -1),
        {
          ...last,
          text,
          complete: true,
          isStreaming: false,
        },
      ];
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
    const tools = createToolRegistry({
      currentModel: modelKey,
      allowedTools: options.allowedTools,
      orchestrator: iris.sessionRef.current?.orchestrator,
      tracker: iris.graphTrackerRef.current ?? undefined,
      agentId: 'root',
      depth: 0,
      diffInterceptor: iris.diffInterceptorRef.current,
    });
    const result = await runAgentLoop([{ role: 'user', content: text }], {
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
      hooks: {
        onClear: () => {
          setMessages([]);
          historyRef.current = [];
        },
        onCompact: () => writeSystemMessage('Compacted. Context window refreshed.'),
        onRunPrompt: async (request) => {
          await handleSubmit(request.text, request.allowedTools, request.model, request.displayAssistantResponse !== false);
        },
        onExecutePrompt: async (request) => executeDetachedPrompt(request.text, request),
        onInfo: writeSystemMessage,
        onError: writeErrorMessage,
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
        onRefreshContext: refreshContext,
        onSetModel: (model) => setActiveModel(normalizeModelKey(model)),
        onSetMode: (mode) => setActiveMode(mode),
      },
    });
    iris.sessionRef.current = session;
    iris.graphTrackerRef.current = session.graphTracker;
    iris.runtime.sessionIdRef.current = session.id;
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
      const modelKey = normalizeModelKey(modelOverrideForPrompt ?? activeModel);
      const modelRegistry = await createModelRegistry(config);
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
      });

      const tools = createToolRegistry({
        currentModel: modelKey,
        allowedTools,
        orchestrator: iris.sessionRef.current!.orchestrator,
        tracker: iris.graphTrackerRef.current ?? undefined,
        agentId: 'root',
        depth: 0,
        diffInterceptor: iris.diffInterceptorRef.current,
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
      messages.map((message) => ({
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

  return (
    <Box flexDirection="column" height="100%" paddingX={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Static items={staticItems}>
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

      <Text color={theme.colors.dim}>{divider}</Text>

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
        canCancelWithEscape={running && !pendingPermission && !pendingDiff && !overlay && !pendingQuestion}
        canExitWithEscape={!running && !pendingPermission && !pendingDiff && !overlay && !pendingQuestion}
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
              })
            : 'passthrough';

          if (result === 'passthrough') {
            await handleSubmit(value);
          } else {
            await iris.sessionRef.current?.save();
          }
        }}
        onCycleMode={handleCycleMode}
        onSuggestionsChange={({ suggestions, selectedIndex }) => {
          setPaletteEntries(suggestions);
          setPaletteSelectedIndex(selectedIndex);
        }}
      />

      <Text color={theme.colors.dim}>{divider}</Text>

      <Box justifyContent="space-between">
        <Box>
          <Text color={theme.colors.muted}>{friendlyModelLabel(activeModel)}</Text>
          <Text color={theme.colors.line}>{' │ '}</Text>
          <Text color={theme.colors.muted}>{projectName}</Text>
          <Text color={theme.colors.line}>{' │ '}</Text>
          <Text color={theme.colors.muted}>{`memory ${estimateContextTokens(config.context_text)}/${config.memory.max_tokens}`}</Text>
          <Text color={theme.colors.line}>{' │ '}</Text>
          <Text color={theme.colors.line}>{'● '}</Text>
          <Text color={theme.colors.muted}>{activeMode}</Text>
          <Text color={theme.colors.line}>{' · '}</Text>
          <Text color={theme.colors.muted}>{iris.runtime.sessionIdRef.current}</Text>
        </Box>
      </Box>
      <Box>
        <Text color="magenta">{'►► '}</Text>
        <Text color={theme.colors.muted}>{modeLabel(activeMode)}</Text>
        <Text color={theme.colors.dim}>{' (shift+tab to cycle)'}</Text>
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
