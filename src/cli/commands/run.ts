import { buildDefaultSystemPrompt } from '../../agent/system-prompt.ts';
import { runAgentLoop } from '../../agent/loop.ts';
import { runSubagentTask } from '../../agent/orchestrator.ts';
import { loadConfig } from '../../config/loader.ts';
import { costTracker } from '../../cost/tracker.ts';
import { createDefaultRegistry as createModelRegistry, parseModelString } from '../../models/registry.ts';
import { PermissionsEngine } from '../../permissions/engine.ts';
import { bus } from '../../shared/events.ts';
import type { Message } from '../../shared/types.ts';
import {
  createDefaultRegistry as createToolRegistry,
  type LoadedSkill,
  ToolRegistry,
} from '../../tools/index.ts';

export interface RunCommandOptions {
  modelOverride?: string;
}

export async function runRunCommand(args: string[], options: RunCommandOptions = {}): Promise<void> {
  const parsed = parseRunArgs(args);
  if (!parsed.prompt) {
    throw new Error('Usage: iriscode run "prompt" [--model provider/model] [--json] [--no-tools]');
  }

  const config = loadConfig();
  const modelKey = normalizeModelKey(options.modelOverride ?? config.defaultModel);

  costTracker.reset();

  const modelRegistry = await createModelRegistry();
  if (!modelRegistry.has(modelKey)) {
    throw new Error(`Unknown or unavailable model "${modelKey}"`);
  }

  const adapter = modelRegistry.get(modelKey);
  const tools = parsed.noTools ? new ToolRegistry() : createToolRegistry({ currentModel: modelKey });
  const permissions = new PermissionsEngine('default');
  const history: Message[] = [{ role: 'user', content: parsed.prompt }];
  const loadedSkills: LoadedSkill[] = [];
  const systemPrompt = buildDefaultSystemPrompt(
    !parsed.noTools,
    tools.getDefinitions().map((tool) => tool.name),
  );

  const offFns = parsed.json ? attachJsonlEventStream() : [];

  try {
    let streamedOutput = '';
    const result = await runAgentLoop(history, {
      adapter,
      tools,
      permissions,
      modelRegistry,
      systemPrompt,
      maxIterations: 10,
      cwd: process.cwd(),
      costTracker,
      loadedSkills,
      subagentDepth: 0,
      runSubagent: parsed.noTools
        ? undefined
        : (description, model) =>
            runSubagentTask(
              description,
              {
                currentModel: modelKey,
                modelRegistry,
                permissionMode: permissions.getMode(),
                cwd: process.cwd(),
                costTracker,
                loadedSkills,
                onToolRequest: async () => true,
              },
              model,
            ),
      onText: (text) => {
        streamedOutput += text;
        if (parsed.json) {
          writeJsonLine({ type: 'text', text });
        } else {
          process.stdout.write(text);
        }
      },
      onToolRequest: async (toolName, input) => {
        if (parsed.json) {
          writeJsonLine({ type: 'tool_call', name: toolName, input });
        }
        return true;
      },
    });

    const { provider, modelId } = parseModelString(modelKey);
    costTracker.add(provider, modelId, result.totalInputTokens, result.totalOutputTokens);

    if (parsed.json) {
      writeJsonLine({
        type: 'done',
        finalText: result.finalText,
        totalInputTokens: result.totalInputTokens,
        totalOutputTokens: result.totalOutputTokens,
        iterations: result.iterations,
        totalCostUsd: costTracker.total().costUsd,
      });
    } else {
      if (!streamedOutput && result.finalText) {
        process.stdout.write(result.finalText);
      }
      if (streamedOutput || result.finalText) {
        if (!(streamedOutput || result.finalText).endsWith('\n')) {
          process.stdout.write('\n');
        }
      }
    }
  } finally {
    offFns.forEach((off) => off());
  }
}

function parseRunArgs(args: string[]): { prompt: string; json: boolean; noTools: boolean } {
  const promptParts: string[] = [];
  let json = false;
  let noTools = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--no-tools') {
      noTools = true;
      continue;
    }
    if ((arg === '--model' || arg === '-m') && args[i + 1]) {
      i += 1;
      continue;
    }
    promptParts.push(arg);
  }

  return {
    prompt: promptParts.join(' ').trim(),
    json,
    noTools,
  };
}

function normalizeModelKey(model: string): string {
  const { provider, modelId } = parseModelString(model);
  return `${provider}/${modelId}`;
}

function attachJsonlEventStream(): Array<() => void> {
  return [
    bus.on('tool:start', ({ name }) => writeJsonLine({ type: 'tool_start', name })),
    bus.on('tool:end', ({ name, durationMs }) => writeJsonLine({ type: 'tool_end', name, durationMs })),
    bus.on('tool:error', ({ name, error }) => writeJsonLine({ type: 'tool_error', name, error })),
    bus.on('agent:start', ({ depth, model, description }) =>
      writeJsonLine({ type: 'agent_start', depth, model, description }),
    ),
    bus.on('agent:done', ({ depth, model, description, response }) =>
      writeJsonLine({ type: 'agent_done', depth, model, description, response }),
    ),
  ];
}

function writeJsonLine(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
