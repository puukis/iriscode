import { WebSocketServer, WebSocket } from 'ws';
import { Session } from '../agent/session.ts';
import type { ToolPermissionChoice } from '../agent/loop.ts';
import type { DiffDecision, DiffViewerRequest } from '../diff/controller.ts';
import type { ResolvedConfig } from '../config/schema.ts';
import { reloadConfig } from '../config/loader.ts';
import { setApiKey } from '../config/secrets.ts';
import type { GraphTracker } from '../graph/tracker.ts';
import { OllamaAdapter } from '../models/providers/ollama.ts';
import { parseModelString } from '../models/registry.ts';
import type { PermissionEngine } from '../permissions/engine.ts';
import { bus } from '../shared/events.ts';
import { logger } from '../shared/logger.ts';
import type { ToolDefinitionSchema } from '../shared/types.ts';
import type { CommandRegistry } from '../commands/registry.ts';
import type { CommandEntry } from '../commands/types.ts';
import type { Session as IrisSession } from '../agent/session.ts';
import type { IrisMessage, IrisRuntimeStore } from '../ui/context.ts';
import { PRICING } from '../cost/pricing.ts';

type OutboundMessage =
  | { type: 'user:message'; text: string }
  | { type: 'user:command'; name: string; args: string[] }
  | { type: 'permission:decision'; decision: 'allow_once' | 'allow_always' | 'deny_once' | 'deny_always' }
  | { type: 'diff:decision'; decision: 'accepted' | 'rejected' }
  | { type: 'session:restore'; sessionId: string }
  | { type: 'session:branch'; fromMessageIndex: number }
  | { type: 'model:switch'; model: string; apiKey?: string }
  | { type: 'mode:switch'; mode: 'default' | 'acceptEdits' | 'plan' }
  | { type: 'run:cancel' }
  | { type: 'ping' };

type InboundMessage =
  | {
      type: 'session:init';
      sessionId: string;
      model: string;
      mode: string;
      messages: IrisMessage[];
      commands: BridgeCommandEntry[];
    }
  | { type: 'token:stream'; text: string; messageId: string }
  | { type: 'token:done'; messageId: string; inputTokens: number; outputTokens: number }
  | { type: 'tool:call'; id: string; name: string; input: Record<string, unknown>; risk: 'low' | 'medium' | 'high' }
  | { type: 'tool:result'; id: string; output: string; isError: boolean; durationMs: number }
  | {
      type: 'cost:update';
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      memoryTokens: number;
      memoryLimit: number;
    }
  | { type: 'graph:update'; snapshot: ReturnType<GraphTracker['getSnapshot']> }
  | {
      type: 'permission:prompt';
      toolName: string;
      input: Record<string, unknown>;
      risk: 'low' | 'medium' | 'high';
      description: string;
    }
  | {
      type: 'diff:prompt';
      filePath: string;
      before: string;
      after: string;
      stats: { added: number; removed: number };
      autoAccept?: boolean;
    }
  | { type: 'skill:loading'; skillName: string }
  | { type: 'agent:status'; status: 'idle' | 'running' | 'streaming' }
  | { type: 'session:list'; sessions: SessionSummary[] }
  | { type: 'models:list'; providers: ProviderInfo[] }
  | { type: 'error'; message: string; code: string }
  | { type: 'pong' };

export interface ProviderInfo {
  name: string;
  envVar: string;
  configured: boolean;
  models: Array<{
    id: string;
    inputPer1M: number;
    outputPer1M: number;
  }>;
  dynamic?: boolean;
}

export interface SessionSummary {
  id: string;
  startedAt: number;
  messageCount: number;
  totalCostUsd: number;
  model: string;
  path: string;
  finalMessage?: string;
}

export interface BridgeCommandEntry {
  name: string;
  description: string;
  category: CommandEntry['category'];
  argumentHint?: string;
}

export interface BridgeRuntimeContext {
  cwd: string;
  sessionRef: { current: IrisSession | null };
  configRef: { current: ResolvedConfig };
  commandRegistryRef: { current: CommandRegistry | null };
  graphTrackerRef: { current: GraphTracker | null };
  permissionEngineRef: { current: PermissionEngine };
  runtime: IrisRuntimeStore;
}

interface PendingPermissionState {
  request: {
    toolName: string;
    input: Record<string, unknown>;
  };
  tool?: ToolDefinitionSchema;
  resolve: (choice: ToolPermissionChoice) => void;
}

interface PendingDiffState {
  request: Extract<DiffViewerRequest, { kind: 'interactive' }>;
}

const PROVIDER_CATALOG: Array<{
  name: string;
  envVar: string;
  models: string[];
  dynamic?: boolean;
}> = [
  { name: 'anthropic', envVar: 'ANTHROPIC_API_KEY', models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { name: 'openai', envVar: 'OPENAI_API_KEY', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'] },
  { name: 'google', envVar: 'GOOGLE_API_KEY', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
  { name: 'groq', envVar: 'GROQ_API_KEY', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  { name: 'mistral', envVar: 'MISTRAL_API_KEY', models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'] },
  { name: 'deepseek', envVar: 'DEEPSEEK_API_KEY', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'xai', envVar: 'XAI_API_KEY', models: ['grok-3', 'grok-3-mini', 'grok-2'] },
  { name: 'perplexity', envVar: 'PERPLEXITY_API_KEY', models: ['sonar-pro', 'sonar', 'sonar-reasoning'] },
  { name: 'together', envVar: 'TOGETHER_API_KEY', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1'] },
  { name: 'fireworks', envVar: 'FIREWORKS_API_KEY', models: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/deepseek-r1'] },
  { name: 'cohere', envVar: 'COHERE_API_KEY', models: ['command-r-plus', 'command-r'] },
  { name: 'openrouter', envVar: 'OPENROUTER_API_KEY', models: ['(dynamic)'], dynamic: true },
];

let activeServer: BridgeServer | null = null;
let promptControllers: {
  clearPermission?: () => void;
  clearDiff?: () => void;
} = {};

export class BridgeServer {
  private readonly port: number;
  private server: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private readonly unsubscribers: Array<() => void> = [];
  private runtime: BridgeRuntimeContext | null = null;
  private pendingPermission: PendingPermissionState | null = null;
  private pendingDiff: PendingDiffState | null = null;
  private lastCost = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  private lastMemory = { tokens: 0, limit: 10_000 };
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(port = 7878) {
    this.port = port;
  }

  attachRuntime(runtime: BridgeRuntimeContext): void {
    this.runtime = runtime;
    this.scheduleSessionSync();
  }

  start(): void {
    if (this.server) {
      return;
    }

    this.server = new WebSocketServer({
      host: '127.0.0.1',
      port: this.port,
    });
    activeServer = this;
    this.subscribeToBus();

    this.server.on('connection', (socket: WebSocket) => {
      logger.debug(`Bridge client connected on ws://127.0.0.1:${this.port}`);
      this.clients.add(socket);
      socket.on('message', (raw: string | Buffer) => {
        void this.handleClientMessage(socket, raw.toString());
      });
      socket.on('close', () => {
        this.clients.delete(socket);
        logger.debug('Bridge client disconnected');
      });
      socket.on('error', (error: unknown) => {
        logger.debug(`Bridge client error: ${error instanceof Error ? error.message : String(error)}`);
      });

      void this.sendInitialState(socket);
    });

    this.server.on('error', (error: unknown) => {
      logger.warn(`Bridge server error: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  stop(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.unsubscribers.splice(0).forEach((off) => off());
    this.clients.forEach((client) => client.close());
    this.clients.clear();
    this.server?.close();
    this.server = null;
    if (activeServer === this) {
      activeServer = null;
    }
  }

  scheduleSessionSync(): void {
    if (this.syncTimer) {
      return;
    }

    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.broadcastSessionState();
    }, 80);
    this.syncTimer.unref?.();
  }

  openPermissionPrompt(state: PendingPermissionState): void {
    this.pendingPermission = state;
    this.broadcast({
      type: 'permission:prompt',
      toolName: state.request.toolName,
      input: state.request.input,
      risk: deriveRisk(state.request.toolName, state.tool?.risk),
      description: describePermissionRequest(state.request.toolName, state.request.input),
    });
  }

  clearPermissionPrompt(): void {
    this.pendingPermission = null;
  }

  openDiffPrompt(request: DiffViewerRequest): void {
    if (request.kind !== 'interactive') {
      return;
    }

    this.pendingDiff = { request };
    this.broadcast({
      type: 'diff:prompt',
      filePath: request.result.filePath,
      before: request.result.before,
      after: request.result.after,
      stats: {
        added: request.result.stats.added,
        removed: request.result.stats.removed,
      },
      autoAccept: request.autoAccept,
    });
  }

  clearDiffPrompt(): void {
    this.pendingDiff = null;
  }

  private subscribeToBus(): void {
    this.unsubscribers.push(
      bus.on('token:stream', ({ messageId, text }) => {
        this.broadcast({ type: 'agent:status', status: 'streaming' });
        this.broadcast({ type: 'token:stream', messageId, text });
      }),
      bus.on('token:done', ({ messageId, inputTokens, outputTokens }) => {
        this.broadcast({ type: 'token:done', messageId, inputTokens, outputTokens });
      }),
      bus.on('tool:call', ({ id, name, input, risk }) => {
        this.broadcast({ type: 'agent:status', status: 'running' });
        this.broadcast({ type: 'tool:call', id, name, input, risk });
      }),
      bus.on('tool:result', ({ id, output, isError, durationMs }) => {
        this.clearPermissionPrompt();
        this.clearDiffPrompt();
        this.broadcast({ type: 'tool:result', id, output, isError, durationMs });
      }),
      bus.on('cost:update', ({ inputTokens, outputTokens, totalCostUsd }) => {
        this.lastCost = {
          inputTokens: this.lastCost.inputTokens + inputTokens,
          outputTokens: this.lastCost.outputTokens + outputTokens,
          costUsd: totalCostUsd,
        };
        this.broadcastCost();
      }),
      bus.on('memory:budget', ({ budget }) => {
        this.lastMemory = { tokens: budget.totalTokens, limit: 10_000 };
        this.broadcastCost();
      }),
      bus.on('graph:update', ({ snapshot }) => {
        this.broadcast({ type: 'graph:update', snapshot });
      }),
      bus.on('session:message-added', ({ message }) => {
        if (message.commandName) {
          this.broadcast({ type: 'skill:loading', skillName: message.commandName });
        }
        this.scheduleSessionSync();
      }),
      bus.on('session:model-changed', () => {
        this.scheduleSessionSync();
      }),
      bus.on('session:mode-changed', () => {
        this.scheduleSessionSync();
      }),
      bus.on('session:restored', () => {
        this.scheduleSessionSync();
      }),
      bus.on('session:saved', () => {
        void this.broadcastSessionList();
      }),
      bus.on('config:reloaded', () => {
        void this.broadcastModelsList();
      }),
      bus.on('agent:start', () => {
        this.broadcast({ type: 'agent:status', status: 'running' });
      }),
      bus.on('agent:done', () => {
        this.broadcast({ type: 'agent:status', status: 'idle' });
        this.scheduleSessionSync();
      }),
      bus.on('agent:error', ({ error }) => {
        this.broadcast({ type: 'agent:status', status: 'idle' });
        this.broadcast({ type: 'error', code: 'agent_error', message: error });
      }),
    );
  }

  private async handleClientMessage(socket: WebSocket, raw: string): Promise<void> {
    let message: OutboundMessage;
    try {
      message = JSON.parse(raw) as OutboundMessage;
    } catch {
      this.send(socket, { type: 'error', code: 'invalid_json', message: 'Invalid JSON payload' });
      return;
    }

    try {
      switch (message.type) {
        case 'user:message':
          await this.runtime?.runtime.sendMessageRef.current(message.text);
          break;
        case 'user:command':
          await this.runtime?.runtime.sendCommandRef.current(`/${message.name}${message.args.length > 0 ? ` ${message.args.join(' ')}` : ''}`);
          break;
        case 'permission:decision':
          this.pendingPermission?.resolve(mapPermissionChoice(message.decision));
          this.clearPermissionPrompt();
          promptControllers.clearPermission?.();
          break;
        case 'diff:decision':
          this.pendingDiff?.request.resolve(message.decision as DiffDecision);
          this.clearDiffPrompt();
          promptControllers.clearDiff?.();
          break;
        case 'session:restore':
          if (!this.runtime?.sessionRef.current) {
            break;
          }
          this.runtime.sessionRef.current.restoreSession((await Session.load(message.sessionId, this.runtime.cwd)).toSnapshot());
          this.scheduleSessionSync();
          break;
        case 'session:branch':
          if (!this.runtime?.sessionRef.current) {
            break;
          }
          this.runtime.sessionRef.current.restoreSession((await this.runtime.sessionRef.current.branch(message.fromMessageIndex)).toSnapshot());
          this.scheduleSessionSync();
          break;
        case 'model:switch':
          if (!this.runtime?.sessionRef.current) {
            break;
          }
          if (message.apiKey) {
            const { provider } = parseModelString(message.model);
            await setApiKey(provider, message.apiKey);
            const nextConfig = await reloadConfig(this.runtime.cwd);
            this.runtime.configRef.current = nextConfig;
            bus.emit('config:reloaded', { config: nextConfig });
          }
          await this.runtime.sessionRef.current.setModel(message.model);
          void this.broadcastModelsList();
          this.scheduleSessionSync();
          break;
        case 'mode:switch':
          this.runtime?.sessionRef.current?.setMode(message.mode);
          this.scheduleSessionSync();
          break;
        case 'run:cancel':
          this.runtime?.runtime.cancelRef.current();
          break;
        case 'ping':
          this.send(socket, { type: 'pong' });
          break;
      }
    } catch (error) {
      this.send(socket, {
        type: 'error',
        code: 'bridge_error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async sendInitialState(socket: WebSocket): Promise<void> {
    await this.sendSessionState(socket);
    await this.sendSessionList(socket);
    await this.sendModelsList(socket);
    this.sendCost(socket);
    const snapshot = this.runtime?.graphTrackerRef.current?.getSnapshot();
    if (snapshot) {
      this.send(socket, { type: 'graph:update', snapshot });
    }
    this.send(socket, {
      type: 'agent:status',
      status: this.runtime?.runtime.isStreamingRef.current
        ? 'streaming'
        : this.runtime?.runtime.isBusyRef.current
          ? 'running'
          : 'idle',
    });
  }

  private async broadcastSessionState(): Promise<void> {
    for (const client of this.clients) {
      await this.sendSessionState(client);
    }
  }

  private async sendSessionState(socket: WebSocket): Promise<void> {
    const session = this.runtime?.sessionRef.current;
    const runtime = this.runtime?.runtime;
    if (!runtime) {
      return;
    }

    this.send(socket, {
      type: 'session:init',
      sessionId: session?.id ?? runtime.sessionIdRef.current,
      model: session?.model ?? runtime.modelRef.current,
      mode: session?.permissionMode ?? runtime.modeRef.current,
      messages: runtime.messagesRef.current,
      commands: (this.runtime?.commandRegistryRef.current?.list() ?? []).map((command) => ({
        name: command.name,
        description: command.description,
        category: command.category,
        argumentHint: command.argumentHint,
      })),
    });
  }

  private async broadcastSessionList(): Promise<void> {
    for (const client of this.clients) {
      await this.sendSessionList(client);
    }
  }

  private async sendSessionList(socket: WebSocket): Promise<void> {
    if (!this.runtime) {
      return;
    }

    const sessions = await Session.listSessions(this.runtime.cwd);
    this.send(socket, {
      type: 'session:list',
      sessions: sessions.map((session) => ({
        id: session.id,
        startedAt: session.startedAt,
        messageCount: session.messageCount,
        totalCostUsd: session.totalCostUsd,
        model: session.model,
        path: session.path,
        finalMessage: session.finalMessage,
      })),
    });
  }

  private async broadcastModelsList(): Promise<void> {
    for (const client of this.clients) {
      await this.sendModelsList(client);
    }
  }

  private async sendModelsList(socket: WebSocket): Promise<void> {
    if (!this.runtime) {
      return;
    }

    const config = await reloadConfig(this.runtime.cwd);
    this.runtime.configRef.current = config;
    this.send(socket, {
      type: 'models:list',
      providers: await buildProviderInfo(config),
    });
  }

  private broadcastCost(): void {
    for (const client of this.clients) {
      this.sendCost(client);
    }
  }

  private sendCost(socket: WebSocket): void {
    this.send(socket, {
      type: 'cost:update',
      inputTokens: this.lastCost.inputTokens,
      outputTokens: this.lastCost.outputTokens,
      costUsd: this.lastCost.costUsd,
      memoryTokens: this.lastMemory.tokens,
      memoryLimit: this.lastMemory.limit,
    });
  }

  private broadcast(message: InboundMessage): void {
    for (const client of this.clients) {
      this.send(client, message);
    }
  }

  private send(socket: WebSocket, message: InboundMessage): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
  }
}

export function attachBridgeRuntime(runtime: BridgeRuntimeContext): void {
  activeServer?.attachRuntime(runtime);
}

export function registerBridgePromptControllers(controllers: {
  clearPermission?: () => void;
  clearDiff?: () => void;
}): void {
  promptControllers = controllers;
}

export function scheduleBridgeSessionSync(): void {
  activeServer?.scheduleSessionSync();
}

export function openBridgePermissionPrompt(state: PendingPermissionState): void {
  activeServer?.openPermissionPrompt(state);
}

export function clearBridgePermissionPrompt(): void {
  activeServer?.clearPermissionPrompt();
}

export function openBridgeDiffPrompt(request: DiffViewerRequest): void {
  activeServer?.openDiffPrompt(request);
}

export function clearBridgeDiffPrompt(): void {
  activeServer?.clearDiffPrompt();
}

async function buildProviderInfo(config: ResolvedConfig): Promise<ProviderInfo[]> {
  const providers = PROVIDER_CATALOG.map((provider) => ({
    name: provider.name,
    envVar: provider.envVar,
    configured: Boolean(config.providers[provider.name as keyof typeof config.providers]?.apiKey),
    dynamic: provider.dynamic,
    models: provider.models.map((modelId) => {
      const pricing = PRICING[`${provider.name}/${modelId}`] ?? { inputPer1k: 0, outputPer1k: 0 };
      return {
        id: modelId,
        inputPer1M: pricing.inputPer1k * 1000,
        outputPer1M: pricing.outputPer1k * 1000,
      };
    }),
  }));

  try {
    const probe = new OllamaAdapter('__probe__', config.providers.ollama.baseUrl ?? undefined);
    const models = await probe.fetchModels();
    providers.push({
      name: 'ollama',
      envVar: 'OLLAMA_BASE_URL',
      configured: true,
      dynamic: false,
      models: models.map((modelId) => ({
        id: modelId,
        inputPer1M: 0,
        outputPer1M: 0,
      })),
    });
  } catch {
    providers.push({
      name: 'ollama',
      envVar: 'OLLAMA_BASE_URL',
      configured: true,
      dynamic: false,
      models: [],
    });
  }

  return providers;
}

function mapPermissionChoice(
  decision: 'allow_once' | 'allow_always' | 'deny_once' | 'deny_always',
): ToolPermissionChoice {
  switch (decision) {
    case 'allow_once':
      return 'allow-once';
    case 'allow_always':
      return 'allow-always';
    case 'deny_always':
      return 'deny-always';
    default:
      return 'deny-once';
  }
}

function deriveRisk(
  toolName: string,
  riskOverride?: 'low' | 'medium' | 'high',
): 'low' | 'medium' | 'high' {
  if (riskOverride) {
    return riskOverride;
  }

  if (toolName.includes(':')) {
    return 'medium';
  }

  if (['read', 'glob', 'grep', 'git-status', 'git-diff', 'tool-search', 'ask-user'].includes(toolName)) {
    return 'low';
  }

  if (['write', 'edit', 'web-search', 'web-fetch', 'todo-write', 'Skill', 'skill'].includes(toolName)) {
    return 'medium';
  }

  return 'high';
}

function describePermissionRequest(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'bash':
      return `bash: ${truncate(String(input.command ?? '(no command)'))}`;
    case 'read':
    case 'write':
    case 'edit':
      return `${toolName}: ${truncate(String(input.path ?? '(no path)'))}`;
    case 'web-fetch':
      return `web-fetch: ${truncate(String(input.url ?? '(no url)'))}`;
    case 'web-search':
      return `web-search: ${truncate(String(input.query ?? '(no query)'))}`;
    case 'git-commit':
      return `git-commit: ${truncate(String(input.message ?? '(no message)'))}`;
    case 'task':
      return `task: ${truncate(String(input.description ?? '(no description)'))}`;
    case 'todo-write':
      return `todo-write: ${Array.isArray(input.todos) ? input.todos.length : 0} todos`;
    case 'ask-user':
      return `ask-user: ${truncate(String(input.question ?? '(no question)'))}`;
    default:
      return `${toolName}: ${truncate(previewInput(input))}`;
  }
}

function previewInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input);
  } catch {
    return Object.entries(input)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ');
  }
}

function truncate(value: string, length = 120): string {
  return value.length <= length ? value : `${value.slice(0, length - 3)}...`;
}
