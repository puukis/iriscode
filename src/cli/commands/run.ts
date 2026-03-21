import { appendContextText, buildDefaultSystemPrompt } from '../../agent/system-prompt.ts';
import { runAgentLoop } from '../../agent/loop.ts';
import { Orchestrator } from '../../agent/orchestrator.ts';
import { loadConfig } from '../../config/loader.ts';
import { costTracker } from '../../cost/tracker.ts';
import { DiffViewerController } from '../../diff/controller.ts';
import { DiffInterceptor } from '../../diff/interceptor.ts';
import { DiffStore } from '../../diff/store.ts';
import { createDefaultRegistry as createModelRegistry, parseModelString } from '../../models/registry.ts';
import { PermissionEngine } from '../../permissions/engine.ts';
import type { PermissionMode } from '../../permissions/types.ts';
import { bus } from '../../shared/events.ts';
import type { Message } from '../../shared/types.ts';
import { GraphTracker } from '../../graph/tracker.ts';
import {
  createDefaultRegistry as createToolRegistry,
  type LoadedSkill,
  ToolRegistry,
} from '../../tools/index.ts';

export interface RunCommandOptions {
  modelOverride?: string;
  modeOverride?: PermissionMode;
}

export async function runRunCommand(args: string[], options: RunCommandOptions = {}): Promise<void> {
  const parsed = parseRunArgs(args);
  if (!parsed.prompt) {
    throw new Error('Usage: iriscode run "prompt" [--model provider/model] [--mode default|acceptEdits|plan] [--json] [--no-tools]');
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const modelKey = normalizeModelKey(options.modelOverride ?? config.model);
  const permissionMode = options.modeOverride ?? parsed.mode ?? config.permissions.mode;

  costTracker.reset();

  const modelRegistry = await createModelRegistry(config);
  if (!modelRegistry.has(modelKey)) {
    throw new Error(`Unknown or unavailable model "${modelKey}"`);
  }

  const adapter = modelRegistry.get(modelKey);
  const permissions = new PermissionEngine(permissionMode, cwd);
  const diffStore = new DiffStore();
  const diffController = new DiffViewerController();
  const diffInterceptor = new DiffInterceptor(diffStore, permissionMode, diffController);
  const history: Message[] = [{ role: 'user', content: parsed.prompt }];
  const loadedSkills: LoadedSkill[] = [];
  const graphTracker = new GraphTracker(parsed.prompt, modelKey);
  const orchestrator = new Orchestrator(config, graphTracker, permissions, {
    cwd,
    currentModel: modelKey,
    costTracker,
    loadedSkills,
    diffInterceptor,
  });
  const tools = parsed.noTools
    ? new ToolRegistry()
    : createToolRegistry({
        currentModel: modelKey,
        orchestrator,
        tracker: graphTracker,
        agentId: 'root',
        depth: 0,
        diffInterceptor,
      });
  const systemPrompt = appendContextText(
    buildDefaultSystemPrompt(
      !parsed.noTools,
      tools.getDefinitions().map((tool) => tool.name),
    ),
    config.context_text,
  );
  orchestrator.updateRuntime({
    onInfo: (text) => writeAuxiliaryOutput(text, parsed.json),
    onPermissionPrompt: async (request) => {
      if (parsed.json) {
        writeJsonLine({ type: 'permission_prompt', toolName: request.toolName, input: request.input });
      }
      return 'deny-once';
    },
  });

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
      cwd,
      costTracker,
      loadedSkills,
      subagentDepth: 0,
      orchestrator,
      tracker: graphTracker,
      agentId: 'root',
      parentAgentId: null,
      depth: 0,
      description: parsed.prompt,
      onText: (text) => {
        streamedOutput += text;
        if (parsed.json) {
          writeJsonLine({ type: 'text', text });
        } else {
          process.stdout.write(text);
        }
      },
      onInfo: (text) => writeAuxiliaryOutput(text, parsed.json),
      onPermissionPrompt: async (request) => {
        if (parsed.json) {
          writeJsonLine({ type: 'permission_prompt', toolName: request.toolName, input: request.input });
        }
        return 'deny-once';
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

function parseRunArgs(args: string[]): { prompt: string; json: boolean; noTools: boolean; mode?: PermissionMode } {
  const promptParts: string[] = [];
  let json = false;
  let noTools = false;
  let mode: PermissionMode | undefined;

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
    if (arg === '--mode' && args[i + 1]) {
      const value = args[++i];
      if (value === 'default' || value === 'acceptEdits' || value === 'plan') {
        mode = value;
      }
      continue;
    }
    promptParts.push(arg);
  }

  return {
    prompt: promptParts.join(' ').trim(),
    json,
    noTools,
    mode,
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

function writeAuxiliaryOutput(text: string, json: boolean): void {
  if (json) {
    writeJsonLine({ type: 'info', text });
  } else {
    process.stdout.write(`${text}\n`);
  }
}

function writeJsonLine(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
