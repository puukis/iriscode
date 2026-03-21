import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { createHash, randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import type { ResolvedConfig } from '../config/schema.ts';
import { ensureDirectory } from '../config/utils.ts';
import { PermissionEngine } from '../permissions/engine.ts';
import type { PermissionMode } from '../permissions/types.ts';
import type { Message } from '../shared/types.ts';
import { bus } from '../shared/events.ts';
import { CostTracker } from '../cost/tracker.ts';
import { GraphTracker } from '../graph/tracker.ts';
import { Orchestrator } from './orchestrator.ts';
import type {
  DetachedPromptRequest,
  LoadedMemoryFile,
  PromptExecutionRequest,
  SessionDisplayMessage,
  SessionSnapshot,
  SessionSnapshotSummary,
  SessionState,
} from '../commands/types.ts';
import { loadConfig } from '../config/loader.ts';

const PROJECT_SESSION_DIR = '.iris/sessions';
const GLOBAL_PROJECTS_DIR = '.iris/projects';

interface SessionHooks {
  onClear?: () => void;
  onCompact?: (summary: string) => void;
  onRunPrompt?: (request: PromptExecutionRequest) => Promise<void>;
  onExecutePrompt?: (request: DetachedPromptRequest) => Promise<string>;
  onInfo?: (text: string) => void;
  onError?: (text: string) => void;
  onAsk?: (question: string) => Promise<string>;
  onGetToolDefinitions?: (allowedTools?: string[]) => ReturnType<SessionState['getToolDefinitions']>;
  onOpenModelPicker?: () => Promise<string | undefined>;
  onOpenSessionPicker?: (sessions: SessionSnapshotSummary[]) => Promise<SessionSnapshotSummary | undefined>;
  onRestoreSnapshot?: (snapshot: SessionSnapshot) => void;
  onRefreshContext?: () => Promise<void>;
  onSetModel?: (model: string) => void | Promise<void>;
  onSetMode?: (mode: PermissionMode) => void;
}

interface SessionOptions {
  cwd: string;
  config: ResolvedConfig;
  permissionEngine: PermissionEngine;
  model?: string;
  permissionMode?: PermissionMode;
  id?: string;
  startedAt?: Date;
  messages?: Message[];
  displayMessages?: SessionDisplayMessage[];
  totalInputTokens?: number;
  totalOutputTokens?: number;
  memoryFiles?: LoadedMemoryFile[];
  costTracker?: CostTracker;
  autosave?: boolean;
  hooks?: SessionHooks;
}

export class Session implements SessionState {
  readonly id: string;
  messages: Message[];
  displayMessages: SessionDisplayMessage[];
  model: string;
  startedAt: number;
  permissionMode: PermissionMode;
  totalInputTokens: number;
  totalOutputTokens: number;
  contextText: string;
  memoryFiles: LoadedMemoryFile[];
  memoryMaxTokens: number;
  readonly costTracker: CostTracker;
  graphTracker: GraphTracker;
  orchestrator: Orchestrator;
  readonly cwd: string;
  permissionEngine: PermissionEngine;
  private config: ResolvedConfig;
  private hooks: SessionHooks;
  private autosaveTimer?: ReturnType<typeof setInterval>;

  constructor(options: SessionOptions) {
    this.cwd = resolve(options.cwd);
    this.config = options.config;
    this.permissionEngine = options.permissionEngine;
    this.id = options.id ?? randomUUID().replace(/-/g, '').slice(0, 8);
    this.messages = structuredClone(options.messages ?? []);
    this.displayMessages = structuredClone(options.displayMessages ?? []);
    this.model = options.model ?? options.config.model;
    this.startedAt = (options.startedAt ?? new Date()).getTime();
    this.permissionMode = options.permissionMode ?? options.permissionEngine.getMode();
    this.totalInputTokens = options.totalInputTokens ?? 0;
    this.totalOutputTokens = options.totalOutputTokens ?? 0;
    this.contextText = options.config.context_text;
    this.memoryFiles = [...(options.memoryFiles ?? [])];
    this.memoryMaxTokens = options.config.memory.max_tokens;
    this.costTracker = options.costTracker ?? new CostTracker();
    this.graphTracker = new GraphTracker('root agent', this.model);
    this.orchestrator = new Orchestrator(options.config, this.graphTracker, this.permissionEngine, {
      cwd: this.cwd,
      currentModel: this.model,
      costTracker: this.costTracker,
      sessionId: this.id,
    });
    this.hooks = options.hooks ?? {};

    if (options.autosave !== false) {
      this.startAutoSave();
    }
  }

  prepareRun(description: string): void {
    this.graphTracker = new GraphTracker(description, this.model);
    this.orchestrator = new Orchestrator(this.config, this.graphTracker, this.permissionEngine, {
      cwd: this.cwd,
      currentModel: this.model,
      costTracker: this.costTracker,
      sessionId: this.id,
    });
  }

  updateConfig(config: ResolvedConfig, memoryFiles: LoadedMemoryFile[]): void {
    this.config = config;
    this.contextText = config.context_text;
    this.memoryFiles = [...memoryFiles];
    this.memoryMaxTokens = config.memory.max_tokens;
    this.orchestrator.updateConfig(config);
    this.orchestrator.updateRuntime({ currentModel: this.model });
  }

  replacePermissionEngine(permissionEngine: PermissionEngine): void {
    this.permissionEngine = permissionEngine;
    this.permissionMode = permissionEngine.getMode();
    this.orchestrator.updatePermissionEngine(permissionEngine);
  }

  clear(): void {
    this.messages = [];
    this.displayMessages = [];
    this.hooks.onClear?.();
  }

  compact(summary: string): void {
    this.messages = [{ role: 'assistant', content: `Conversation summary:\n${summary}` }];
    this.displayMessages = [{ role: 'system', text: 'Compacted. Context window refreshed.' }];
    this.hooks.onCompact?.(summary);
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    this.orchestrator.updateRuntime({ currentModel: model });
    await this.hooks.onSetModel?.(model);
  }

  setMode(mode: PermissionMode): void {
    this.permissionMode = mode;
    this.permissionEngine.setMode(mode);
    this.hooks.onSetMode?.(mode);
  }

  async runPrompt(request: PromptExecutionRequest): Promise<void> {
    await this.hooks.onRunPrompt?.(request);
  }

  async executePrompt(request: DetachedPromptRequest): Promise<string> {
    if (!this.hooks.onExecutePrompt) {
      return '';
    }
    return this.hooks.onExecutePrompt(request);
  }

  writeInfo(text: string): void {
    this.hooks.onInfo?.(text);
  }

  writeError(text: string): void {
    this.hooks.onError?.(text);
  }

  async ask(question: string): Promise<string> {
    if (!this.hooks.onAsk) {
      return '';
    }
    return this.hooks.onAsk(question);
  }

  getToolDefinitions(allowedTools?: string[]) {
    return this.hooks.onGetToolDefinitions?.(allowedTools) ?? [];
  }

  async openModelPicker(): Promise<string | undefined> {
    return this.hooks.onOpenModelPicker?.();
  }

  async openSessionPicker(sessions: SessionSnapshotSummary[]): Promise<SessionSnapshotSummary | undefined> {
    return this.hooks.onOpenSessionPicker?.(sessions);
  }

  restoreSession(snapshot: SessionSnapshot): void {
    this.messages = structuredClone(snapshot.messages);
    this.displayMessages = structuredClone(snapshot.displayMessages);
    this.model = snapshot.model;
    this.permissionMode = snapshot.permissionMode;
    this.totalInputTokens = snapshot.totalInputTokens;
    this.totalOutputTokens = snapshot.totalOutputTokens;
    this.costTracker.restore(snapshot.costEntries);
    this.orchestrator.updateRuntime({ currentModel: snapshot.model });
    this.permissionEngine.setMode(snapshot.permissionMode);
    this.hooks.onRestoreSnapshot?.(snapshot);
  }

  async refreshContext(): Promise<void> {
    await this.hooks.onRefreshContext?.();
  }

  async save(): Promise<void> {
    const snapshot = this.toSnapshot();
    const projectPath = this.getProjectSessionPath(this.id);
    const globalPath = this.getGlobalSessionPath(this.id);
    await Promise.all([
      atomicWriteJson(projectPath, snapshot),
      atomicWriteJson(globalPath, snapshot),
    ]);
    bus.emit('session:saved', { sessionId: this.id, path: projectPath });
  }

  async branch(fromMessageIndex: number): Promise<Session> {
    const branched = new Session({
      cwd: this.cwd,
      config: this.config,
      permissionEngine: new PermissionEngine(this.permissionMode, this.cwd),
      model: this.model,
      permissionMode: this.permissionMode,
      messages: this.messages.slice(0, Math.max(0, fromMessageIndex + 1)),
      displayMessages: this.displayMessages.slice(0, Math.max(0, fromMessageIndex + 1)),
      memoryFiles: this.memoryFiles,
      autosave: false,
    });
    await branched.save();
    return branched;
  }

  stopAutoSave(): void {
    if (!this.autosaveTimer) {
      return;
    }
    clearInterval(this.autosaveTimer);
    this.autosaveTimer = undefined;
  }

  toSnapshot(): SessionSnapshot {
    return {
      id: this.id,
      startedAt: this.startedAt,
      model: this.model,
      permissionMode: this.permissionMode,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCostUsd: this.costTracker.total().costUsd,
      costEntries: this.costTracker.total().entries,
      messages: structuredClone(this.messages),
      displayMessages: structuredClone(this.displayMessages),
    };
  }

  static async load(id: string, cwd: string): Promise<Session> {
    const absoluteCwd = resolve(cwd);
    const snapshot = loadSnapshotFromDisk(id, absoluteCwd);
    if (!snapshot) {
      throw new Error(`Session "${id}" was not found.`);
    }

    const config = await loadConfig(absoluteCwd);
    const costTracker = new CostTracker();
    costTracker.restore(snapshot.costEntries);
    return new Session({
      cwd: absoluteCwd,
      config,
      permissionEngine: new PermissionEngine(snapshot.permissionMode, absoluteCwd),
      id: snapshot.id,
      startedAt: new Date(snapshot.startedAt),
      messages: snapshot.messages,
      displayMessages: snapshot.displayMessages,
      model: snapshot.model,
      permissionMode: snapshot.permissionMode,
      totalInputTokens: snapshot.totalInputTokens,
      totalOutputTokens: snapshot.totalOutputTokens,
      costTracker,
      autosave: false,
    });
  }

  static async listSessions(cwd: string): Promise<SessionSnapshotSummary[]> {
    const absoluteCwd = resolve(cwd);
    const entries = listSnapshotPaths(absoluteCwd);
    const summaries = entries
      .map((path) => {
        try {
          const snapshot = JSON.parse(readFileSync(path, 'utf-8')) as SessionSnapshot;
          const lastAssistant = [...snapshot.displayMessages]
            .reverse()
            .find((message) => message.role === 'assistant')?.text ?? '';
          return {
            id: snapshot.id,
            startedAt: snapshot.startedAt,
            messageCount: snapshot.messages.length,
            totalCostUsd: snapshot.totalCostUsd,
            finalMessage: truncate(lastAssistant, 100),
            model: snapshot.model,
            path,
          } satisfies SessionSnapshotSummary;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return summaries.sort((left, right) => right.startedAt - left.startedAt);
  }

  private startAutoSave(): void {
    this.autosaveTimer = setInterval(() => {
      void this.save();
    }, 30_000);
    this.autosaveTimer.unref?.();
  }

  private getProjectSessionPath(id: string): string {
    return resolve(ensureDirectory(join(this.cwd, PROJECT_SESSION_DIR)), `${id}.json`);
  }

  private getGlobalSessionPath(id: string): string {
    const projectHash = hashProjectPath(this.cwd);
    return resolve(
      ensureDirectory(join(process.env.HOME ?? homedir(), GLOBAL_PROJECTS_DIR, projectHash, 'sessions')),
      `${id}.json`,
    );
  }
}

function hashProjectPath(cwd: string): string {
  return createHash('sha1').update(resolve(cwd)).digest('hex').slice(0, 12);
}

function listSnapshotPaths(cwd: string): string[] {
  const projectHash = hashProjectPath(cwd);
  const projectDir = resolve(ensureDirectory(join(cwd, PROJECT_SESSION_DIR)));
  const globalDir = resolve(
    ensureDirectory(join(process.env.HOME ?? homedir(), GLOBAL_PROJECTS_DIR, projectHash, 'sessions')),
  );
  const paths = new Map<string, string>();

  const candidates = [projectDir, globalDir];
  for (const directory of candidates) {
    if (!existsSync(directory)) {
      continue;
    }
    for (const entry of readdirSync(directory)) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const id = entry.replace(/\.json$/i, '');
      if (!paths.has(id) || directory === projectDir) {
        paths.set(id, resolve(directory, entry));
      }
    }
  }

  return Array.from(paths.values());
}

function loadSnapshotFromDisk(id: string, cwd: string): SessionSnapshot | null {
  const projectHash = hashProjectPath(cwd);
  const candidates = [
    resolve(cwd, PROJECT_SESSION_DIR, `${id}.json`),
    resolve(process.env.HOME ?? homedir(), GLOBAL_PROJECTS_DIR, projectHash, 'sessions', `${id}.json`),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as SessionSnapshot;
    } catch {
      continue;
    }
  }

  return null;
}

async function atomicWriteJson(path: string, payload: unknown): Promise<void> {
  const absolutePath = resolve(path);
  ensureDirectory(dirname(absolutePath));
  const tempPath = `${absolutePath}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, absolutePath);
}

function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, Math.max(0, length - 3))}...`;
}
