import type { BaseAdapter } from '../models/base-adapter.ts';
import { parseModelString, type ModelRegistry } from '../models/registry.ts';
import type { PermissionsEngine } from '../permissions/engine.ts';
import type { Message, ToolDefinitionSchema, ToolResult } from '../shared/types.ts';
import type { CostTracker } from '../cost/tracker.ts';
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

  registry.register(new ReadFileTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new BashTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());

  registry.registerAlias('read_file', 'read');
  registry.registerAlias('write_file', 'write');
  registry.registerAlias('edit_file', 'edit');

  const { provider } = parseModelString(options.currentModel ?? 'anthropic/claude-sonnet-4-6');
  if (provider !== 'bedrock' && provider !== 'vertex') {
    registry.register(new WebSearchTool());
  }

  registry.register(new WebFetchTool());
  registry.register(new GitStatusTool());
  registry.register(new GitDiffTool());
  registry.register(new GitCommitTool());
  registry.register(new ToolSearchTool());
  registry.register(new TaskTool());
  registry.register(new SkillTool());
  registry.register(new AskUserTool());
  registry.register(new TodoWriteTool());

  return registry;
}
