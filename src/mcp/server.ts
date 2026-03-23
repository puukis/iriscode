import { appendContextText, buildDefaultSystemPrompt } from '../agent/system-prompt.ts';
import { runAgentLoop } from '../agent/loop.ts';
import { Orchestrator } from '../agent/orchestrator.ts';
import { createHeadlessSession } from '../agent/headless-session.ts';
import { loadConfig } from '../config/loader.ts';
import { CostTracker } from '../cost/tracker.ts';
import { DiffViewerController } from '../diff/controller.ts';
import { DiffInterceptor } from '../diff/interceptor.ts';
import { DiffStore } from '../diff/store.ts';
import { GraphTracker } from '../graph/tracker.ts';
import { createDefaultRegistry as createModelRegistry, parseModelString } from '../models/registry.ts';
import { PermissionEngine } from '../permissions/engine.ts';
import { logger } from '../shared/logger.ts';
import { createDefaultRegistry as createToolRegistry } from '../tools/index.ts';
import { McpRegistry } from './registry.ts';
import { HookRegistry } from '../hooks/registry.ts';
import { loadHooks } from '../hooks/loader.ts';
import { runEventHooks } from '../hooks/runner.ts';
import { CommandRegistry } from '../commands/registry.ts';
import { activatePlugin, loadPlugins } from '../plugins/loader.ts';
import { loadSkills } from '../skills/loader.ts';

type IncomingRequest = {
  jsonrpc?: '2.0';
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

export class McpServer {
  private buffer = '';
  private mcpRegistry: McpRegistry | null = null;
  private config: Awaited<ReturnType<typeof loadConfig>> | null = null;

  async start(): Promise<void> {
    this.config = await loadConfig(process.cwd());
    this.mcpRegistry = new McpRegistry(this.config.mcp_servers);
    await this.mcpRegistry.initialize();
    const shutdown = async () => {
      await this.mcpRegistry?.disconnectAll();
      process.exit(0);
    };

    process.on('exit', () => {
      void this.mcpRegistry?.disconnectAll();
    });
    process.once('SIGINT', () => {
      void shutdown();
    });
    process.once('SIGTERM', () => {
      void shutdown();
    });

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        void this.handleLine(trimmed);
      }
    });
    process.stdin.resume();

    await new Promise<void>(() => {});
  }

  private async handleLine(line: string): Promise<void> {
    let request: IncomingRequest;
    try {
      request = JSON.parse(line) as IncomingRequest;
    } catch {
      this.writeResponse(null, undefined, {
        code: -32700,
        message: 'Parse error',
      });
      return;
    }

    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      this.writeResponse(request.id ?? null, undefined, {
        code: -32600,
        message: 'Invalid Request',
      });
      return;
    }

    try {
      switch (request.method) {
        case 'initialize':
          this.writeResponse(request.id ?? null, {
            name: 'iriscode',
            version: '0.1.0',
            capabilities: { tools: {} },
          });
          return;
        case 'tools/list':
          this.writeResponse(request.id ?? null, {
            tools: [{
              name: 'run',
              description: 'Run an IrisCode agent task and return the result',
              inputSchema: {
                type: 'object',
                properties: {
                  prompt: { type: 'string' },
                  model: { type: 'string' },
                },
                required: ['prompt'],
              },
            }],
          });
          return;
        case 'tools/call': {
          const result = await this.handleToolCall(request.params);
          this.writeResponse(request.id ?? null, result);
          return;
        }
        case 'shutdown':
          this.writeResponse(request.id ?? null, { ok: true });
          await this.mcpRegistry?.disconnectAll();
          process.exit(0);
          return;
        default:
          if (request.method.startsWith('notifications/')) {
            return;
          }
          this.writeResponse(request.id ?? null, undefined, {
            code: -32601,
            message: `Method not found: ${request.method}`,
          });
      }
    } catch (error) {
      this.writeResponse(request.id ?? null, undefined, {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleToolCall(params: unknown): Promise<{ content: Array<{ type: 'text'; text: string }>; isError: boolean }> {
    const input = typeof params === 'object' && params !== null ? params as Record<string, unknown> : {};
    const name = typeof input.name === 'string' ? input.name : '';
    const argumentsValue = typeof input.arguments === 'object' && input.arguments !== null
      ? input.arguments as Record<string, unknown>
      : {};

    if (name !== 'run') {
      throw new Error(`Unknown MCP tool "${name}"`);
    }

    const prompt = typeof argumentsValue.prompt === 'string' ? argumentsValue.prompt.trim() : '';
    if (!prompt) {
      throw new Error('run.prompt must be a non-empty string');
    }

    const response = await this.runAgentTask(
      prompt,
      typeof argumentsValue.model === 'string' ? argumentsValue.model : undefined,
    );

    return {
      isError: false,
      content: [{ type: 'text', text: response }],
    };
  }

  private async runAgentTask(prompt: string, modelOverride?: string): Promise<string> {
    const config = this.config ?? await loadConfig(process.cwd());
    const hookRegistry = new HookRegistry();
    const [hookLoad, pluginResult, skillResult] = await Promise.all([
      loadHooks(process.cwd(), hookRegistry),
      loadPlugins(process.cwd()),
      loadSkills(process.cwd()),
    ]);
    const mcpRegistry = this.mcpRegistry ?? new McpRegistry(config.mcp_servers);
    const bootstrapRegistry = new CommandRegistry();
    for (const plugin of pluginResult.plugins) {
      await activatePlugin(plugin, bootstrapRegistry, skillResult, hookRegistry, mcpRegistry, process.cwd());
    }
    if (!this.mcpRegistry) {
      await mcpRegistry.initialize();
    }
    const modelKey = normalizeModelKey(modelOverride ?? config.model);
    const permissions = new PermissionEngine(config.permissions.mode, process.cwd());
    const modelRegistry = await createModelRegistry(config);
    const costTracker = new CostTracker();

    if (!modelRegistry.has(modelKey)) {
      throw new Error(`Unknown or unavailable model "${modelKey}"`);
    }

    const adapter = modelRegistry.get(modelKey);
    const diffInterceptor = new DiffInterceptor(
      new DiffStore(),
      config.permissions.mode,
      new DiffViewerController(),
    );
    const graphTracker = new GraphTracker(prompt, modelKey);
    const orchestrator = new Orchestrator(config, graphTracker, permissions, {
      cwd: process.cwd(),
      currentModel: modelKey,
      costTracker,
      diffInterceptor,
      mcpRegistry,
      hookRegistry,
      skillResult,
    });
    hookLoad.errors.forEach((error) => logger.warn(error));
    pluginResult.errors.forEach((error) => logger.warn(`${error.path}: ${error.error}`));
    skillResult.errors.forEach((error) => logger.warn(`${error.path}: ${error.error}`));
    const session = createHeadlessSession({
      cwd: process.cwd(),
      config,
      permissionEngine: permissions,
      model: modelKey,
      mcpRegistry,
    });
    const tools = createToolRegistry({
      currentModel: modelKey,
      orchestrator,
      tracker: graphTracker,
      agentId: 'root',
      depth: 0,
      diffInterceptor,
      mcpRegistry,
      permissionEngine: permissions,
      skillResult,
      session,
    });
    const systemPrompt = appendContextText(
      buildDefaultSystemPrompt(true, tools.getDefinitions().map((tool) => tool.name)),
      config.context_text,
    );

    const history = [{ role: 'user' as const, content: prompt }];
    session.messages = history;
    await runEventHooks('session:start', {
      event: 'session:start',
      timing: 'pre',
      sessionId: session.id,
    }, hookRegistry);
    const result = await runAgentLoop(history, {
      adapter,
      tools,
      permissions,
      modelRegistry,
      systemPrompt,
      cwd: process.cwd(),
      costTracker,
      orchestrator,
      tracker: graphTracker,
      agentId: 'root',
      parentAgentId: null,
      depth: 0,
      description: prompt,
      onPermissionPrompt: async () => 'deny-once',
      hookRegistry,
      session,
    }).finally(async () => {
      await runEventHooks('session:end', {
        event: 'session:end',
        timing: 'post',
        sessionId: session.id,
      }, hookRegistry);
    });

    const { provider, modelId } = parseModelString(modelKey);
    costTracker.add(provider, modelId, result.totalInputTokens, result.totalOutputTokens);
    return result.finalText;
  }

  private writeResponse(id: string | number | null, result?: unknown, error?: { code: number; message: string }): void {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id,
      ...(error ? { error } : { result }),
    })}\n`);
  }
}

function normalizeModelKey(model: string): string {
  const { provider, modelId } = parseModelString(model);
  return `${provider}/${modelId}`;
}
