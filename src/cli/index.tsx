#!/usr/bin/env bun
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { render, Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { runAgentLoop, type ToolPermissionChoice } from '../agent/loop.ts';
import { Session } from '../agent/session.ts';
import { appendContextText, buildDefaultSystemPrompt } from '../agent/system-prompt.ts';
import { loadConfig, reloadConfig } from '../config/loader.ts';
import { loadGlobalConfig } from '../config/global.ts';
import { loadProjectConfig } from '../config/project.ts';
import { setApiKey } from '../config/secrets.ts';
import { startConfigWatcher } from '../config/watcher.ts';
import type { ResolvedConfig } from '../config/schema.ts';
import { costTracker } from '../cost/tracker.ts';
import { DiffViewerController, type DiffViewerRequest } from '../diff/controller.ts';
import { DiffInterceptor } from '../diff/interceptor.ts';
import { DiffStore } from '../diff/store.ts';
import { createDefaultRegistry as createModelRegistry, parseModelString } from '../models/registry.ts';
import { PermissionEngine } from '../permissions/engine.ts';
import type { PermissionMode, PermissionRequest, PermissionResult } from '../permissions/types.ts';
import { bus } from '../shared/events.ts';
import { logger } from '../shared/logger.ts';
import type { DiffResult, Message, ToolDefinitionSchema } from '../shared/types.ts';
import { createDefaultRegistry as createCommandRegistry, CommandRegistry } from '../commands/registry.ts';
import { loadCustomCommands } from '../commands/custom/loader.ts';
import { registerSkillCommands } from '../commands/skill-bridge.ts';
import { type LoadedMemoryFile, type SessionSnapshotSummary } from '../commands/types.ts';
import { handleInput } from './input-handler.ts';
import { PermissionPrompt } from '../ui/components/permission-prompt.tsx';
import { CommandPalette } from '../ui/components/command-palette.tsx';
import { DiffViewer } from '../ui/components/diff-viewer.tsx';
import { ModelPicker } from '../ui/components/model-picker.tsx';
import { SessionPicker } from '../ui/components/session-picker.tsx';
import { TaskGraph } from '../ui/components/task-graph.tsx';
import { runConfigCommand } from './commands/config.ts';
import { runCostCommand } from './commands/cost.ts';
import { runModelsCommand } from './commands/models.ts';
import { runRunCommand } from './commands/run.ts';
import { buildStartupSummary } from './startup-summary.ts';
import {
  createDefaultRegistry as createToolRegistry,
  type LoadedSkill,
} from '../tools/index.ts';

const cwd = process.cwd();
const args = process.argv.slice(2);
const subcommand = args[0];

let modelOverride: string | undefined;
let modeOverride: PermissionMode | undefined;
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--model' || args[i] === '-m') && args[i + 1]) {
    modelOverride = args[++i];
    continue;
  }
  if (args[i] === '--mode' && args[i + 1]) {
    const value = args[++i];
    if (value === 'default' || value === 'acceptEdits' || value === 'plan') {
      modeOverride = value;
    }
  }
}

let initialConfig: ResolvedConfig;
let initialMemoryFiles: LoadedMemoryFile[];
try {
  initialConfig = await loadConfig(cwd);
  initialMemoryFiles = await loadContextFilesForSession(cwd);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

logger.setLevel(initialConfig.log_level as Parameters<typeof logger.setLevel>[0]);
const stopWatching = startConfigWatcher(cwd);
process.on('exit', stopWatching);

if (subcommand === 'models') {
  await runModelsCommand();
  process.exit(0);
}

if (subcommand === 'cost') {
  runCostCommand();
  process.exit(0);
}

if (subcommand === 'config') {
  await runConfigCommand(cwd, args.slice(1));
  process.exit(0);
}

if (subcommand === 'run') {
  try {
    await runRunCommand(args.slice(1), { modelOverride, modeOverride });
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

interface PendingPermissionPrompt {
  request: PermissionRequest;
  result: PermissionResult;
  tool?: ToolDefinitionSchema;
  resolve: (choice: ToolPermissionChoice) => void;
}

type PendingDiffView = DiffViewerRequest;

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
    };

function App({
  cwd,
  initialConfig,
  initialMemoryFiles,
  modelOverride,
  modeOverride,
}: {
  cwd: string;
  initialConfig: ResolvedConfig;
  initialMemoryFiles: LoadedMemoryFile[];
  modelOverride?: string;
  modeOverride?: PermissionMode;
}) {
  const initialModel = normalizeModelKey(modelOverride ?? initialConfig.model);
  const initialMode = modeOverride ?? initialConfig.permissions.mode;

  const [config, setConfig] = useState(initialConfig);
  const [memoryFiles, setMemoryFiles] = useState(initialMemoryFiles);
  const [activeModel, setActiveModel] = useState(initialModel);
  const [activeMode, setActiveMode] = useState(initialMode);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'system',
      text: `IrisCode — ${buildStartupSummary(
        initialModel,
        initialMode,
        initialConfig.memory.max_tokens,
        initialConfig.context_text,
      )}`,
    },
  ]);
  const [running, setRunning] = useState(false);
  const [sessionCost, setSessionCost] = useState(0);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermissionPrompt | null>(null);
  const [pendingDiff, setPendingDiff] = useState<PendingDiffView | null>(null);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [questionInput, setQuestionInput] = useState('');
  const [commandPlaceholder, setCommandPlaceholder] = useState('Ask anything...');
  const [commandRegistry, setCommandRegistry] = useState<CommandRegistry | null>(null);
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0);
  const historyRef = useRef<Message[]>([]);
  const displayMessagesRef = useRef<ChatMessage[]>(messages);
  const loadedSkillsRef = useRef<LoadedSkill[]>([]);
  const permissionsRef = useRef(new PermissionEngine(initialMode, cwd));
  const sessionIdRef = useRef(globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}`);
  const sessionStartedAtRef = useRef(Date.now());
  const pendingQuestionResolverRef = useRef<((answer: string) => void) | null>(null);
  const configRef = useRef(initialConfig);
  const memoryFilesRef = useRef(initialMemoryFiles);
  const activeModelRef = useRef(initialModel);
  const activeModeRef = useRef(initialMode);
  const totalInputTokensRef = useRef(0);
  const totalOutputTokensRef = useRef(0);
  const commandRegistryRef = useRef<CommandRegistry | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const diffStoreRef = useRef(new DiffStore());
  const diffControllerRef = useRef(
    new DiffViewerController((request) => {
      setPendingDiff(request);
    }),
  );
  const diffInterceptorRef = useRef(
    new DiffInterceptor(diffStoreRef.current, initialMode, diffControllerRef.current),
  );
  const modelPinnedRef = useRef(Boolean(modelOverride));
  const modePinnedRef = useRef(Boolean(modeOverride));

  useEffect(() => {
    displayMessagesRef.current = messages;
    if (sessionRef.current) {
      sessionRef.current.displayMessages = structuredClone(messages);
    }
  }, [messages]);

  useEffect(() => {
    configRef.current = config;
    sessionRef.current?.updateConfig(config, memoryFilesRef.current);
  }, [config]);

  useEffect(() => {
    memoryFilesRef.current = memoryFiles;
    sessionRef.current?.updateConfig(configRef.current, memoryFiles);
  }, [memoryFiles]);

  useEffect(() => {
    activeModelRef.current = activeModel;
    if (sessionRef.current) {
      sessionRef.current.model = activeModel;
      sessionRef.current.orchestrator.updateRuntime({ currentModel: activeModel });
    }
  }, [activeModel]);

  useEffect(() => {
    activeModeRef.current = activeMode;
    permissionsRef.current.setMode(activeMode);
    diffInterceptorRef.current.setMode(activeMode);
    if (sessionRef.current) {
      sessionRef.current.permissionMode = activeMode;
    }
  }, [activeMode]);

  useEffect(() => {
    let exiting = false;

    const saveSession = async () => {
      if (exiting) {
        return;
      }
      exiting = true;
      try {
        await sessionRef.current?.save();
      } finally {
        sessionRef.current?.stopAutoSave();
      }
    };

    const handleSigint = () => {
      void saveSession().finally(() => process.exit(0));
    };
    const handleSigterm = () => {
      void saveSession().finally(() => process.exit(0));
    };
    const handleBeforeExit = () => {
      void saveSession();
    };

    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);
    process.once('beforeExit', handleBeforeExit);

    return () => {
      process.off('SIGINT', handleSigint);
      process.off('SIGTERM', handleSigterm);
      process.off('beforeExit', handleBeforeExit);
      sessionRef.current?.stopAutoSave();
    };
  }, []);

  const updateBanner = useCallback(() => {
    const banner = buildBanner(
      activeModelRef.current,
      activeModeRef.current,
      configRef.current.memory.max_tokens,
      configRef.current.context_text,
    );
    setMessages((current) => {
      if (current.length === 0) {
        return [{ role: 'system', text: banner }];
      }

      const [first, ...rest] = current;
      if (first.role === 'system' && first.text.startsWith('IrisCode — ')) {
        return [{ role: 'system', text: banner }, ...rest];
      }
      return [{ role: 'system', text: banner }, ...current];
    });
  }, []);

  const writeSystemMessage = useCallback((text: string) => {
    setMessages((current) => {
      const next = [...current, { role: 'system' as const, text }];
      if (sessionRef.current) {
        sessionRef.current.displayMessages = structuredClone(next);
      }
      return next;
    });
  }, []);

  const writeErrorMessage = useCallback((text: string) => {
    setMessages((current) => {
      const next = [...current, { role: 'system' as const, text: `Error: ${text}` }];
      if (sessionRef.current) {
        sessionRef.current.displayMessages = structuredClone(next);
      }
      return next;
    });
  }, []);

  const askUser = useCallback(async (question: string): Promise<string> => {
    if (pendingQuestionResolverRef.current) {
      throw new Error('Another ask-user prompt is already active');
    }

    return new Promise<string>((resolve) => {
      pendingQuestionResolverRef.current = resolve;
      setQuestionInput('');
      setPendingQuestion(question);
    });
  }, []);

  const requestPermission = useCallback(
    async (
      request: PermissionRequest,
      result: PermissionResult,
      tool?: ToolDefinitionSchema,
    ): Promise<ToolPermissionChoice> => {
      return new Promise<ToolPermissionChoice>((resolve) => {
        setPendingPermission({ request, result, tool, resolve });
      });
    },
    [],
  );

  const refreshContext = useCallback(async () => {
    const nextConfig = await reloadConfig(cwd);
    const nextMemoryFiles = await loadContextFilesForSession(cwd);
    setConfig(nextConfig);
    setMemoryFiles(nextMemoryFiles);
    updateBanner();
  }, [cwd, updateBanner]);

  const executePrompt = useCallback(
    async (
      text: string,
      options: { allowedTools?: string[]; model?: string; displayAssistantResponse?: boolean },
    ): Promise<void> => {
      setRunning(true);

      try {
        const session = sessionRef.current;
        if (!session) {
          throw new Error('Session is not initialized.');
        }

        const modelKey = normalizeModelKey(options.model ?? activeModelRef.current);
        const modelRegistry = await createModelRegistry(configRef.current);
        if (!modelRegistry.has(modelKey)) {
          throw new Error(`Unknown or unavailable model "${modelKey}"`);
        }

        session.prepareRun(text);
        session.orchestrator.updateRuntime({
          currentModel: modelKey,
          loadedSkills: loadedSkillsRef.current,
          askUser,
          onInfo: writeSystemMessage,
          onPermissionPrompt: requestPermission,
          diffInterceptor: diffInterceptorRef.current,
        });

        const adapter = modelRegistry.get(modelKey);
        const tools = createToolRegistry({
          currentModel: modelKey,
          allowedTools: options.allowedTools,
          orchestrator: session.orchestrator,
          tracker: session.graphTracker,
          agentId: 'root',
          depth: 0,
          diffInterceptor: diffInterceptorRef.current,
        });
        const permissions = session.permissionEngine;
        permissionsRef.current = permissions;
        const baseSystemPrompt = appendContextText(
          buildDefaultSystemPrompt(
            true,
            tools.getDefinitions().map((tool) => tool.name),
          ),
          configRef.current.context_text,
        );

        let assistantOutput = '';
        historyRef.current.push({ role: 'user', content: text });
        session.messages = historyRef.current;
        const result = await runAgentLoop(historyRef.current, {
          adapter,
          tools,
          permissions,
          modelRegistry,
          maxIterations: 10,
          cwd,
          sessionId: session.id,
          systemPrompt: baseSystemPrompt,
          costTracker: session.costTracker,
          loadedSkills: loadedSkillsRef.current,
          subagentDepth: 0,
          orchestrator: session.orchestrator,
          tracker: session.graphTracker,
          agentId: 'root',
          parentAgentId: null,
          depth: 0,
          description: text,
          askUser,
          onText: (chunk) => {
            assistantOutput += chunk;
          },
          onInfo: writeSystemMessage,
          onPermissionPrompt: requestPermission,
        });

        totalInputTokensRef.current += result.totalInputTokens;
        totalOutputTokensRef.current += result.totalOutputTokens;
        session.totalInputTokens = totalInputTokensRef.current;
        session.totalOutputTokens = totalOutputTokensRef.current;
        const { provider, modelId } = parseModelString(modelKey);
        session.costTracker.add(provider, modelId, result.totalInputTokens, result.totalOutputTokens);
        setSessionCost(session.costTracker.total().costUsd);

        if (options.displayAssistantResponse !== false) {
          setMessages((current) => {
            const next = [
              ...current,
              { role: 'assistant' as const, text: assistantOutput || result.finalText || '(no response)' },
            ];
            session.displayMessages = structuredClone(next);
            return next;
          });
        }

        await session.save();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeErrorMessage(message);
      } finally {
        pendingQuestionResolverRef.current = null;
        setPendingQuestion(null);
        setPendingPermission(null);
        setQuestionInput('');
        setRunning(false);
      }
    },
    [askUser, cwd, requestPermission, writeErrorMessage, writeSystemMessage],
  );

  const executeDetachedPrompt = useCallback(
    async (text: string, options: { allowedTools?: string[]; model?: string; systemPrompt?: string }): Promise<string> => {
      const session = sessionRef.current;
      if (!session) {
        throw new Error('Session is not initialized.');
      }

      const modelKey = normalizeModelKey(options.model ?? activeModelRef.current);
      const modelRegistry = await createModelRegistry(configRef.current);
      if (!modelRegistry.has(modelKey)) {
        throw new Error(`Unknown or unavailable model "${modelKey}"`);
      }

      session.prepareRun(text);
      session.orchestrator.updateRuntime({
        currentModel: modelKey,
        loadedSkills: loadedSkillsRef.current,
        diffInterceptor: diffInterceptorRef.current,
      });

      const adapter = modelRegistry.get(modelKey);
      const tools = createToolRegistry({
        currentModel: modelKey,
        allowedTools: options.allowedTools,
        orchestrator: session.orchestrator,
        tracker: session.graphTracker,
        agentId: 'root',
        depth: 0,
        diffInterceptor: diffInterceptorRef.current,
      });
      const permissions = session.permissionEngine;
      const systemPrompt = options.systemPrompt ?? appendContextText(
        buildDefaultSystemPrompt(
          true,
          tools.getDefinitions().map((tool) => tool.name),
        ),
        configRef.current.context_text,
      );

      const history: Message[] = [{ role: 'user', content: text }];
      const result = await runAgentLoop(history, {
        adapter,
        tools,
        permissions,
        modelRegistry,
        maxIterations: 10,
        cwd,
        sessionId: session.id,
        systemPrompt,
        costTracker: session.costTracker,
        loadedSkills: loadedSkillsRef.current,
        subagentDepth: 0,
        orchestrator: session.orchestrator,
        tracker: session.graphTracker,
        agentId: 'root',
        parentAgentId: null,
        depth: 0,
        description: text,
      });

      totalInputTokensRef.current += result.totalInputTokens;
      totalOutputTokensRef.current += result.totalOutputTokens;
      session.totalInputTokens = totalInputTokensRef.current;
      session.totalOutputTokens = totalOutputTokensRef.current;
      const { provider, modelId } = parseModelString(modelKey);
      session.costTracker.add(provider, modelId, result.totalInputTokens, result.totalOutputTokens);
      setSessionCost(session.costTracker.total().costUsd);

      return result.finalText;
    },
    [cwd],
  );

  if (!sessionRef.current) {
    const permissionEngine = permissionsRef.current;
    const session = new Session({
      cwd,
      config: configRef.current,
      permissionEngine,
      model: activeModelRef.current,
      permissionMode: activeModeRef.current,
      id: sessionIdRef.current,
      startedAt: new Date(sessionStartedAtRef.current),
      messages: historyRef.current,
      displayMessages: displayMessagesRef.current,
      memoryFiles: memoryFilesRef.current,
      costTracker,
      diffStore: diffStoreRef.current,
      hooks: {
        onClear: () => {
          historyRef.current = [];
          setMessages([
            {
              role: 'system',
              text: buildBanner(
                activeModelRef.current,
                activeModeRef.current,
                configRef.current.memory.max_tokens,
                configRef.current.context_text,
              ),
            },
          ]);
        },
        onCompact: (summary) => {
          historyRef.current = [{ role: 'assistant', content: `Conversation summary:\n${summary}` }];
          setMessages((current) => [
            current[0] ?? {
              role: 'system',
              text: buildBanner(
                activeModelRef.current,
                activeModeRef.current,
                configRef.current.memory.max_tokens,
                configRef.current.context_text,
              ),
            },
            { role: 'system', text: 'Compacted. Context window refreshed.' },
          ]);
        },
        onRunPrompt: async (request) => {
          await executePrompt(request.text, request);
        },
        onExecutePrompt: async (request) => executeDetachedPrompt(request.text, request),
        onInfo: writeSystemMessage,
        onError: writeErrorMessage,
        onAsk: askUser,
        onGetToolDefinitions: (allowedTools) =>
          createToolRegistry({
            currentModel: activeModelRef.current,
            allowedTools,
            orchestrator: sessionRef.current?.orchestrator,
            tracker: sessionRef.current?.graphTracker,
            agentId: 'root',
            depth: 0,
            diffInterceptor: diffInterceptorRef.current,
          }).getDefinitions(),
        onViewDiff: async (diff, options) => {
          if (options?.readOnly) {
            return diffControllerRef.current.showReadOnly(diff);
          }
          return diffControllerRef.current.show(diff, Boolean(options?.autoAccept));
        },
        onOpenModelPicker: async () => {
          const registry = await createModelRegistry(configRef.current);
          return new Promise<string | undefined>((resolve) => {
            setOverlay({
              kind: 'model-picker',
              availableModels: registry.keys(),
              resolve,
            });
          });
        },
        onOpenSessionPicker: async (sessions) =>
          new Promise<SessionSnapshotSummary | undefined>((resolve) => {
            setOverlay({
              kind: 'session-picker',
              sessions,
              resolve,
            });
          }),
        onRestoreSnapshot: (snapshot) => {
          historyRef.current = structuredClone(snapshot.messages);
          totalInputTokensRef.current = snapshot.totalInputTokens;
          totalOutputTokensRef.current = snapshot.totalOutputTokens;
          costTracker.restore(snapshot.costEntries);
          setSessionCost(snapshot.totalCostUsd);
          setActiveModel(normalizeModelKey(snapshot.model));
          setActiveMode(snapshot.permissionMode);
          setMessages(
            snapshot.displayMessages.length > 0
              ? snapshot.displayMessages
              : [
                  {
                    role: 'system',
                    text: buildBanner(
                      activeModelRef.current,
                      activeModeRef.current,
                      configRef.current.memory.max_tokens,
                      configRef.current.context_text,
                    ),
                  },
                ],
          );
        },
        onRefreshContext: refreshContext,
        onSetModel: (model) => {
          modelPinnedRef.current = true;
          const normalized = normalizeModelKey(model);
          setActiveModel(normalized);
          updateBanner();
        },
        onSetMode: (mode) => {
          modePinnedRef.current = true;
          setActiveMode(mode);
          permissionsRef.current.setMode(mode);
          updateBanner();
        },
      },
    });
    sessionRef.current = session;
    historyRef.current = session.messages;
    displayMessagesRef.current = session.displayMessages;
    totalInputTokensRef.current = session.totalInputTokens;
    totalOutputTokensRef.current = session.totalOutputTokens;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSlashCommands() {
      const registry = createCommandRegistry({
        args: [],
        session: sessionRef.current!,
        config: configRef.current,
        engine: permissionsRef.current,
        cwd,
      });
      const customCommands = await loadCustomCommands(cwd);
      for (const entry of customCommands) {
        registry.registerCustom(entry);
      }
      await registerSkillCommands(registry, cwd);
      if (!cancelled) {
        commandRegistryRef.current = registry;
        setCommandRegistry(registry);
      }
    }

    void loadSlashCommands();
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  useEffect(() => {
    return bus.on('config:reloaded', ({ config: nextConfig }) => {
      void (async () => {
        logger.setLevel(nextConfig.log_level as Parameters<typeof logger.setLevel>[0]);
        const nextMemoryFiles = await loadContextFilesForSession(cwd);
        setConfig(nextConfig);
        setMemoryFiles(nextMemoryFiles);
        if (!modelPinnedRef.current) {
          setActiveModel(normalizeModelKey(nextConfig.model));
        }
        const nextMode = modePinnedRef.current ? activeModeRef.current : nextConfig.permissions.mode;
        if (!modePinnedRef.current) {
          setActiveMode(nextMode);
        }
        const nextEngine = new PermissionEngine(nextMode, cwd);
        permissionsRef.current = nextEngine;
        diffInterceptorRef.current.setMode(nextMode);
        sessionRef.current?.replacePermissionEngine(nextEngine);
        sessionRef.current?.updateConfig(nextConfig, nextMemoryFiles);
        writeSystemMessage(
          `Config reloaded — ${buildStartupSummary(
            modelPinnedRef.current ? activeModelRef.current : normalizeModelKey(nextConfig.model),
            nextMode,
            nextConfig.memory.max_tokens,
            nextConfig.context_text,
          )}`,
        );
        updateBanner();
      })();
    });
  }, [cwd, updateBanner, writeSystemMessage]);

  const paletteState = useMemo(() => {
    if (!commandRegistry || !input.startsWith('/')) {
      return null;
    }
    const trimmed = input.slice(1);
    const spaceIndex = trimmed.indexOf(' ');
    const query = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
    const hasArgs = spaceIndex !== -1;
    const entries = query
      ? commandRegistry.search(query)
      : commandRegistry.list().slice(0, 8);
    return { query, entries, hasArgs };
  }, [commandRegistry, input]);

  useInput((_input, key) => {
    if (pendingQuestion || pendingPermission || pendingDiff || overlay || running) {
      return;
    }
    if (!paletteState || paletteState.hasArgs || paletteState.entries.length === 0) {
      return;
    }

    if (key.upArrow) {
      setCommandPaletteIndex((current) => (current + paletteState.entries.length - 1) % paletteState.entries.length);
      return;
    }
    if (key.downArrow) {
      setCommandPaletteIndex((current) => (current + 1) % paletteState.entries.length);
      return;
    }
    if (key.escape) {
      setInput('');
      setCommandPlaceholder('Ask anything...');
    }
  });

  const handleQuestionSubmit = useCallback((value: string) => {
    const resolveQuestion = pendingQuestionResolverRef.current;
    if (!resolveQuestion) {
      return;
    }

    pendingQuestionResolverRef.current = null;
    setPendingQuestion(null);
    setQuestionInput('');
    setMessages((prev) => {
      const next = [...prev, { role: 'system' as const, text: `[User input] ${value}` }];
      if (sessionRef.current) {
        sessionRef.current.displayMessages = structuredClone(next);
      }
      return next;
    });
    resolveQuestion(value);
  }, []);

  const handlePermissionChoice = useCallback((choice: ToolPermissionChoice) => {
    setPendingPermission((current) => {
      if (!current) {
        return current;
      }

      current.resolve(choice);
      return null;
    });
  }, []);

  const handleDiffDecision = useCallback((decision: 'accepted' | 'rejected') => {
    setPendingDiff((current) => {
      if (!current || current.kind !== 'interactive') {
        return current;
      }

      current.resolve(decision);
      return null;
    });
  }, []);

  const handleDiffAcceptAll = useCallback(() => {
    diffControllerRef.current.acceptAll();
  }, []);

  const handleDiffClose = useCallback(() => {
    setPendingDiff((current) => {
      if (!current || current.kind !== 'readonly') {
        return current;
      }

      current.resolve();
      return null;
    });
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    setCommandPaletteIndex(0);

    if (!value.startsWith('/') || !commandRegistryRef.current) {
      setCommandPlaceholder('Ask anything...');
      return;
    }

    const parsed = value.slice(1);
    const spaceIndex = parsed.indexOf(' ');
    if (spaceIndex !== -1) {
      const commandName = parsed.slice(0, spaceIndex).trim().toLowerCase();
      const entry = commandRegistryRef.current.get(commandName)?.entry;
      setCommandPlaceholder(entry?.argumentHint ?? 'Ask anything...');
      return;
    }

    setCommandPlaceholder('Ask anything...');
  }, []);

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }

      diffControllerRef.current.reset();

      if (paletteState && !paletteState.hasArgs && paletteState.entries.length > 0) {
        const selected = paletteState.entries[commandPaletteIndex] ?? paletteState.entries[0];
        setInput(`/${selected.name}${selected.argumentHint ? ' ' : ' '}`);
        setCommandPlaceholder(selected.argumentHint ?? 'Ask anything...');
        return;
      }

      setInput('');
      setCommandPlaceholder('Ask anything...');
      setMessages((current) => {
        const next = [...current, { role: 'user' as const, text: trimmed }];
        if (sessionRef.current) {
          sessionRef.current.displayMessages = structuredClone(next);
        }
        return next;
      });

      if (commandRegistryRef.current) {
        const result = await handleInput(trimmed, {
          args: [],
          session: sessionRef.current!,
          config: configRef.current,
          engine: permissionsRef.current,
          cwd,
          registry: commandRegistryRef.current,
        });
        if (result === 'handled') {
          await sessionRef.current?.save();
          return;
        }
      }

      await sessionRef.current!.runPrompt({ text: trimmed });
    },
    [commandPaletteIndex, cwd, paletteState],
  );

  return (
    <Box flexDirection="column" padding={1}>
      {messages.map((message, index) => (
        <Box key={index} marginBottom={1}>
          <Text
            color={message.role === 'user' ? 'cyan' : message.role === 'system' ? 'yellow' : 'white'}
            bold={message.role === 'user'}
          >
            {message.role === 'user' ? '> ' : message.role === 'system' ? '• ' : '  '}
            {message.text}
          </Text>
        </Box>
      ))}

      <TaskGraph />

      {pendingQuestion ? (
        <Box flexDirection="column">
          <Text color="yellow">{pendingQuestion}</Text>
          <Box>
            <Text color="cyan" bold>{'> '}</Text>
            <TextInput
              value={questionInput}
              onChange={setQuestionInput}
              onSubmit={handleQuestionSubmit}
              placeholder="Type your answer..."
            />
          </Box>
        </Box>
      ) : pendingPermission ? (
        <PermissionPrompt
          request={pendingPermission.request}
          tool={pendingPermission.tool}
          onSelect={handlePermissionChoice}
        />
      ) : pendingDiff ? (
        <DiffViewer
          result={pendingDiff.result}
          mode="sideBySide"
          readOnly={pendingDiff.kind === 'readonly'}
          autoAccept={pendingDiff.kind === 'interactive' ? pendingDiff.autoAccept : false}
          onAccept={() => handleDiffDecision('accepted')}
          onReject={() => handleDiffDecision('rejected')}
          onAcceptAll={handleDiffAcceptAll}
          onClose={handleDiffClose}
        />
      ) : overlay?.kind === 'model-picker' ? (
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
            setOverlay(null);
          }}
          onConfigureProvider={async (provider, key, model) => {
            await setApiKey(provider, key);
            const nextConfig = await reloadConfig(cwd);
            const nextMemoryFiles = await loadContextFilesForSession(cwd);
            setConfig(nextConfig);
            setMemoryFiles(nextMemoryFiles);
          }}
        />
      ) : overlay?.kind === 'session-picker' ? (
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
      ) : running ? (
        <Text color="gray">thinking...</Text>
      ) : (
        <Box flexDirection="column">
          {paletteState && !paletteState.hasArgs ? (
            <CommandPalette
              query={paletteState.query}
              entries={paletteState.entries}
              selectedIndex={Math.min(commandPaletteIndex, Math.max(paletteState.entries.length - 1, 0))}
            />
          ) : null}
          <Box>
            <Text color="cyan" bold>{'> '}</Text>
            <TextInput
              value={input}
              onChange={handleInputChange}
              onSubmit={handleSubmit}
              placeholder={commandPlaceholder}
            />
          </Box>
          {sessionCost > 0 ? (
            <Text color="gray" dimColor>
              {`  session cost: $${sessionCost.toFixed(6)}`}
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

render(
  <App
    cwd={cwd}
    initialConfig={initialConfig}
    initialMemoryFiles={initialMemoryFiles}
    modelOverride={modelOverride}
    modeOverride={modeOverride}
  />,
);

function buildBanner(model: string, mode: PermissionMode, maxTokens: number, contextText: string): string {
  return `IrisCode — ${buildStartupSummary(model, mode, maxTokens, contextText)}`;
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
