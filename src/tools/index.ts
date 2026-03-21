import type { BaseAdapter } from '../models/base-adapter.ts';
import { parseModelString, type ModelRegistry } from '../models/registry.ts';
import type { PermissionsEngine } from '../permissions/engine.ts';
import type { Message, ToolDefinitionSchema, ToolResult } from '../shared/types.ts';
import type { CostTracker } from '../cost/tracker.ts';
import type { Orchestrator } from '../agent/orchestrator.ts';
import type { GraphTracker } from '../graph/tracker.ts';
import { ReadFileTool } from './file/read.ts';
import { WriteFileTool } from './file/write.ts';
import { EditFileTool } from './file/edit.ts';
import { BashTool } from './shell/bash.ts';
import { GlobTool } from './search/glob.ts';
import { GrepTool } from './search/grep.ts';
import { WebSearchTool } from './search/web-search.ts';
import { WebFetchTool } from './search/web-fetch.ts';
import { GitStatusTool } from './git/status.ts';
import { GitDiffTool } from './git/diff.ts';
import { GitCommitTool } from './git/commit.ts';
import { ToolSearchTool } from './discovery/tool-search.ts';
import { TaskTool } from './orchestration/task.ts';
import { SkillTool } from './orchestration/skill.ts';
import { AskUserTool } from './orchestration/ask-user.ts';
import { TodoWriteTool } from './orchestration/todo-write.ts';

export interface LoadedSkill {
  name: string;
  path: string;
  instructions: string;
}

export interface ToolExecutionContext {
  history: Message[];
  cwd: string;
  model: string;
  adapter: BaseAdapter;
  modelRegistry: ModelRegistry;
  registry: ToolRegistry;
  permissions: PermissionsEngine;
  loadedSkills: LoadedSkill[];
  subagentDepth: number;
  depth: number;
  agentId: string;
  orchestrator?: Orchestrator;
  tracker?: GraphTracker;
  baseSystemPrompt?: string;
  askUser?: (question: string) => Promise<string>;
  runSubagent?: (description: string, model?: string) => Promise<string>;
  costTracker?: CostTracker;
}

export interface Tool {
  readonly definition: ToolDefinitionSchema;
  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult>;
}

export type { ToolDefinitionSchema, ToolResult };

export interface DefaultToolRegistryOptions {
  currentModel?: string;
  allowedTools?: string[];
  orchestrator?: Orchestrator;
  tracker?: GraphTracker;
  agentId?: string;
  depth?: number;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private aliases = new Map<string, string>();

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  registerAlias(alias: string, target: string): void {
    this.aliases.set(alias, target);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(this.resolve(name));
  }

  getDefinitions(): ToolDefinitionSchema[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(this.resolve(name));
  }

  private resolve(name: string): string {
    return this.aliases.get(name) ?? name;
  }
}

export function createDefaultRegistry(options: DefaultToolRegistryOptions = {}): ToolRegistry {
  const registry = new ToolRegistry();
  const allowed = options.allowedTools
    ? new Set(options.allowedTools.map((name) => name.trim().toLowerCase()).filter(Boolean))
    : null;

  const register = (tool: Tool) => {
    if (allowed && !allowed.has(tool.definition.name.toLowerCase())) {
      return;
    }
    registry.register(tool);
  };

  register(new ReadFileTool());
  register(new WriteFileTool());
  register(new EditFileTool());
  register(new BashTool());
  register(new GlobTool());
  register(new GrepTool());

  registry.registerAlias('read_file', 'read');
  registry.registerAlias('write_file', 'write');
  registry.registerAlias('edit_file', 'edit');

  const { provider } = parseModelString(options.currentModel ?? 'anthropic/claude-sonnet-4-6');
  if (provider !== 'bedrock' && provider !== 'vertex') {
    register(new WebSearchTool());
  }

  register(new WebFetchTool());
  register(new GitStatusTool());
  register(new GitDiffTool());
  register(new GitCommitTool());
  register(new ToolSearchTool());
  register(new TaskTool(options.orchestrator));
  register(new SkillTool());
  register(new AskUserTool());
  register(new TodoWriteTool());

  return registry;
}
