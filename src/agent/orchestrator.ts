import { randomUUID } from 'crypto';
import { runAgentLoop, type AgentLoopOptions } from './loop.ts';
import { buildDefaultSystemPrompt } from './system-prompt.ts';
import { SubagentContext } from './subagent.ts';
import { createDefaultRegistry, type LoadedSkill } from '../tools/index.ts';
import { bus } from '../shared/events.ts';
import { ToolError } from '../shared/errors.ts';
import { parseModelString, type ModelRegistry } from '../models/registry.ts';
import { PermissionEngine } from '../permissions/engine.ts';
import type { PermissionMode } from '../permissions/types.ts';
import type { CostTracker } from '../cost/tracker.ts';
import type { ResolvedConfig } from '../config/schema.ts';
import type { GraphTracker } from '../graph/tracker.ts';
import type { AgentNode } from '../graph/model.ts';
import type { DiffInterceptor } from '../diff/interceptor.ts';

export interface RunSubagentTaskOptions {
  currentModel: string;
  modelRegistry: ModelRegistry;
  permissions?: PermissionEngine;
  permissionMode?: PermissionMode;
  baseSystemPrompt?: string;
  maxIterations?: number;
  cwd?: string;
  askUser?: (question: string) => Promise<string>;
  costTracker?: CostTracker;
  loadedSkills?: LoadedSkill[];
  subagentDepth?: number;
  sessionId?: string;
  onInfo?: AgentLoopOptions['onInfo'];
  onPermissionPrompt?: AgentLoopOptions['onPermissionPrompt'];
}

export interface SpawnOptions {
  description: string;
  model?: string;
  parentId: string | null;
  depth: number;
}

interface OrchestratorRuntimeOptions {
  cwd?: string;
  currentModel?: string;
  costTracker?: CostTracker;
  sessionId?: string;
  askUser?: (question: string) => Promise<string>;
  loadedSkills?: LoadedSkill[];
  onInfo?: AgentLoopOptions['onInfo'];
  onPermissionPrompt?: AgentLoopOptions['onPermissionPrompt'];
  diffInterceptor?: DiffInterceptor;
}

export class Orchestrator {
  private config: ResolvedConfig;
  private tracker: GraphTracker;
  private permissionEngine: PermissionEngine;
  private cwd: string;
  private currentModel: string;
  private costTracker?: CostTracker;
  private sessionId?: string;
  private askUser?: OrchestratorRuntimeOptions['askUser'];
  private loadedSkills: LoadedSkill[];
  private onInfo?: OrchestratorRuntimeOptions['onInfo'];
  private onPermissionPrompt?: OrchestratorRuntimeOptions['onPermissionPrompt'];
  private diffInterceptor?: DiffInterceptor;
  private readonly activeAgents = new Map<string, { id: string; startedAt: number }>();

  constructor(
    config: ResolvedConfig,
    tracker: GraphTracker,
    permissionEngine: PermissionEngine,
    options: OrchestratorRuntimeOptions = {},
  ) {
    this.config = config;
    this.tracker = tracker;
    this.permissionEngine = permissionEngine;
    this.cwd = options.cwd ?? process.cwd();
    this.currentModel = normalizeModelKey(options.currentModel ?? config.model);
    this.costTracker = options.costTracker;
    this.sessionId = options.sessionId;
    this.askUser = options.askUser;
    this.loadedSkills = [...(options.loadedSkills ?? [])];
    this.onInfo = options.onInfo;
    this.onPermissionPrompt = options.onPermissionPrompt;
    this.diffInterceptor = options.diffInterceptor;
  }

  updateConfig(config: ResolvedConfig): void {
    this.config = config;
  }

  updateTracker(tracker: GraphTracker): void {
    this.tracker = tracker;
  }

  updatePermissionEngine(permissionEngine: PermissionEngine): void {
    this.permissionEngine = permissionEngine;
  }

  updateRuntime(options: Partial<OrchestratorRuntimeOptions>): void {
    if (options.cwd !== undefined) {
      this.cwd = options.cwd;
    }
    if (options.currentModel !== undefined) {
      this.currentModel = normalizeModelKey(options.currentModel);
    }
    if (options.costTracker !== undefined) {
      this.costTracker = options.costTracker;
    }
    if (options.sessionId !== undefined) {
      this.sessionId = options.sessionId;
    }
    if (options.askUser !== undefined) {
      this.askUser = options.askUser;
    }
    if (options.loadedSkills !== undefined) {
      this.loadedSkills = [...options.loadedSkills];
    }
    if (options.onInfo !== undefined) {
      this.onInfo = options.onInfo;
    }
    if (options.onPermissionPrompt !== undefined) {
      this.onPermissionPrompt = options.onPermissionPrompt;
    }
    if (options.diffInterceptor !== undefined) {
      this.diffInterceptor = options.diffInterceptor;
    }
  }

  async spawnSubagent(options: SpawnOptions): Promise<string> {
    if (options.depth >= 5) {
      bus.emit('agent:depth-exceeded', {
        agentId: options.parentId ?? 'root',
        depth: options.depth,
      });
      throw new ToolError(
        'Maximum subagent depth of 5 reached. Cannot spawn further subagents.',
        'task',
      );
    }

    const model = normalizeModelKey(options.model ?? this.currentModel ?? this.config.model);
    const agentId = `subagent-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const parentId = options.parentId ?? 'root';

    this.tracker.taskDelegated(parentId, agentId, options.description);
    this.activeAgents.set(agentId, { id: agentId, startedAt: Date.now() });

    const subagent = new SubagentContext({
      id: agentId,
      parentId,
      description: options.description,
      model,
      depth: options.depth,
      config: this.config,
      tracker: this.tracker,
      permissionEngine: this.permissionEngine,
      orchestrator: this,
      cwd: this.cwd,
      loadedSkills: this.loadedSkills,
      askUser: this.askUser,
      onInfo: this.onInfo,
      onPermissionPrompt: this.onPermissionPrompt,
      parentCostTracker: this.costTracker,
      diffInterceptor: this.diffInterceptor,
    });

    try {
      const result = await subagent.run(options.description);
      this.tracker.taskResolved(parentId, agentId, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.tracker.taskResolved(parentId, agentId, `Error: ${message}`);
      throw error;
    } finally {
      this.activeAgents.delete(agentId);
    }
  }

  getActiveAgents(): AgentNode[] {
    const snapshot = this.tracker.getSnapshot();
    return snapshot.nodes
      .filter((node) => node.status === 'running')
      .map((node) => ({
        ...node,
        startedAt: new Date(node.startedAt),
        finishedAt: node.finishedAt ? new Date(node.finishedAt) : undefined,
      }));
  }

  getTotalCost(): number {
    return this.costTracker?.total().costUsd ?? 0;
  }
}

export async function runSubagentTask(
  description: string,
  options: RunSubagentTaskOptions,
  modelOverride?: string,
): Promise<string> {
  const nextDepth = (options.subagentDepth ?? 0) + 1;
  if (nextDepth > 5) {
    throw new ToolError('Subagent depth limit exceeded (max 5)', 'task');
  }

  const modelKey = normalizeModelKey(modelOverride ?? options.currentModel);
  if (!options.modelRegistry.has(modelKey)) {
    throw new ToolError(`Unknown subagent model "${modelKey}"`, 'task');
  }

  const adapter = options.modelRegistry.get(modelKey);
  const loadedSkills = [...(options.loadedSkills ?? [])];
  const tools = createDefaultRegistry({ currentModel: modelKey });
  const permissions =
    options.permissions ?? new PermissionEngine(options.permissionMode ?? 'default', options.cwd);
  const systemPrompt =
    options.baseSystemPrompt ??
    buildDefaultSystemPrompt(true, tools.getDefinitions().map((tool) => tool.name));

  bus.emit('agent:start', {
    depth: nextDepth,
    model: modelKey,
    description,
  });

  try {
    const history = [{ role: 'user' as const, content: description }];
    const result = await runAgentLoop(history, {
      adapter,
      tools,
      permissions,
      systemPrompt,
      maxIterations: options.maxIterations ?? 10,
      modelRegistry: options.modelRegistry,
      cwd: options.cwd,
      askUser: options.askUser,
      costTracker: options.costTracker,
      loadedSkills,
      subagentDepth: nextDepth,
      sessionId: options.sessionId,
      runSubagent: (nestedDescription, nestedModel) =>
        runSubagentTask(
          nestedDescription,
          {
            ...options,
            currentModel: modelKey,
            permissions,
            loadedSkills,
            subagentDepth: nextDepth,
          },
          nestedModel,
        ),
      onInfo: options.onInfo,
      onPermissionPrompt: options.onPermissionPrompt,
      agentId: `compat-${nextDepth}`,
      parentAgentId: nextDepth > 1 ? `compat-${nextDepth - 1}` : 'root',
      depth: nextDepth,
      description,
    });

    const { provider, modelId } = parseModelString(modelKey);
    options.costTracker?.add(provider, modelId, result.totalInputTokens, result.totalOutputTokens);

    bus.emit('agent:done', {
      depth: nextDepth,
      model: modelKey,
      description,
      response: result.finalText,
    });

    return result.finalText;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    bus.emit('agent:done', {
      depth: nextDepth,
      model: modelKey,
      description,
      response: `Error: ${message}`,
    });
    throw err;
  }
}

function normalizeModelKey(model: string): string {
  const { provider, modelId } = parseModelString(model);
  return `${provider}/${modelId}`;
}
