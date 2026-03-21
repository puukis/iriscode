import { runAgentLoop, type AgentLoopOptions } from './loop.ts';
import { buildDefaultSystemPrompt } from './system-prompt.ts';
import { createDefaultRegistry, type LoadedSkill } from '../tools/index.ts';
import { bus } from '../shared/events.ts';
import { ToolError } from '../shared/errors.ts';
import { parseModelString, type ModelRegistry } from '../models/registry.ts';
import { PermissionsEngine } from '../permissions/engine.ts';
import type { PermissionMode } from '../shared/types.ts';
import type { CostTracker } from '../cost/tracker.ts';

export interface RunSubagentTaskOptions {
  currentModel: string;
  modelRegistry: ModelRegistry;
  permissionMode?: PermissionMode;
  baseSystemPrompt?: string;
  maxIterations?: number;
  cwd?: string;
  askUser?: (question: string) => Promise<string>;
  costTracker?: CostTracker;
  loadedSkills?: LoadedSkill[];
  subagentDepth?: number;
  onToolRequest?: AgentLoopOptions['onToolRequest'];
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
      permissions: new PermissionsEngine(options.permissionMode ?? 'default'),
      systemPrompt,
      maxIterations: options.maxIterations ?? 10,
      modelRegistry: options.modelRegistry,
      cwd: options.cwd,
      askUser: options.askUser,
      costTracker: options.costTracker,
      loadedSkills,
      subagentDepth: nextDepth,
      runSubagent: (nestedDescription, nestedModel) =>
        runSubagentTask(
          nestedDescription,
          {
            ...options,
            currentModel: modelKey,
            loadedSkills,
            subagentDepth: nextDepth,
          },
          nestedModel,
        ),
      onToolRequest: options.onToolRequest,
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
