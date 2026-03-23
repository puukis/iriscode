import { bus } from '../shared/events.ts';
import { logger } from '../shared/logger.ts';
import { McpClient } from './client.ts';
import type { McpCallResult, McpServerConfig, McpServerState, McpTool } from './types.ts';

export class McpRegistry {
  private readonly configs = new Map<string, McpServerConfig>();
  private readonly order: string[] = [];
  private readonly clients = new Map<string, McpClient>();
  private readonly states = new Map<string, McpServerState>();

  constructor(configs: McpServerConfig[]) {
    for (const config of configs) {
      this.upsertConfig(config);
    }
  }

  async initialize(): Promise<void> {
    const enabledServers = this.order
      .map((name) => this.configs.get(name)!)
      .filter((config) => config.enabled !== false);

    const results = await Promise.allSettled(enabledServers.map((config) => this.initializeServer(config)));
    const requiredFailures: Error[] = [];

    results.forEach((result, index) => {
      const config = enabledServers[index];
      if (result.status === 'fulfilled') {
        return;
      }

      if (config.required) {
        requiredFailures.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
        return;
      }

      logger.warn(`[mcp:${config.name}] ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    });

    if (requiredFailures.length > 0) {
      throw requiredFailures[0];
    }
  }

  getTools(): McpTool[] {
    return Array.from(this.states.values()).flatMap((state) => state.tools);
  }

  getServerStates(): McpServerState[] {
    return this.order
      .map((name) => this.states.get(name))
      .filter((state): state is McpServerState => state !== undefined)
      .map((state) => ({
        ...state,
        tools: [...state.tools],
      }));
  }

  async callTool(
    serverName: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<McpCallResult> {
    const client = this.clients.get(serverName);
    if (!client || !client.isConnected()) {
      const result = {
        isError: true,
        content: [{ type: 'error', text: `MCP server "${serverName}" is not connected.` }],
      } satisfies McpCallResult;
      bus.emit('mcp:tool-called', { serverName, toolName, input, isError: true });
      return result;
    }

    const result = await client.callTool(toolName, input);
    bus.emit('mcp:tool-called', { serverName, toolName, input, isError: result.isError });
    return result;
  }

  async reconnect(serverName: string): Promise<void> {
    const config = this.configs.get(serverName);
    if (!config) {
      throw new Error(`Unknown MCP server "${serverName}"`);
    }

    await this.disconnectServer(serverName);
    await this.initializeServer(config);
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled(this.order.map((name) => this.disconnectServer(name)));
  }

  getServer(name: string): McpServerState | undefined {
    const state = this.states.get(name);
    if (!state) {
      return undefined;
    }
    return {
      ...state,
      tools: [...state.tools],
    };
  }

  async addServer(config: McpServerConfig): Promise<void> {
    this.upsertConfig(config);
    if (config.enabled === false) {
      return;
    }
    await this.initializeServer(this.configs.get(config.name)!);
  }

  async removeServer(name: string): Promise<void> {
    await this.disconnectServer(name);
    this.clients.delete(name);
    this.states.delete(name);
    this.configs.delete(name);
    const index = this.order.indexOf(name);
    if (index !== -1) {
      this.order.splice(index, 1);
    }
  }

  private upsertConfig(config: McpServerConfig): void {
    const normalized = {
      ...config,
      args: [...(config.args ?? [])],
      enabled: config.enabled ?? true,
      required: config.required ?? false,
      startup_timeout_sec: config.startup_timeout_sec ?? 10,
      tool_timeout_sec: config.tool_timeout_sec ?? 60,
      http_headers: config.http_headers ? { ...config.http_headers } : undefined,
      env_http_headers: config.env_http_headers ? { ...config.env_http_headers } : undefined,
    } satisfies McpServerConfig;

    if (!this.configs.has(normalized.name)) {
      this.order.push(normalized.name);
    }

    this.configs.set(normalized.name, normalized);
    this.states.set(normalized.name, {
      config: normalized,
      status: 'disconnected',
      tools: [],
    });
  }

  private async initializeServer(config: McpServerConfig): Promise<void> {
    this.states.set(config.name, {
      config,
      status: 'connecting',
      tools: [],
    });

    const client = new McpClient(config);

    try {
      const tools = await client.initialize();
      this.clients.set(config.name, client);
      this.states.set(config.name, {
        config,
        status: 'connected',
        tools,
        connectedAt: new Date(),
      });
      bus.emit('mcp:server-connected', { serverName: config.name, tools });
    } catch (error) {
      this.clients.delete(config.name);
      const message = error instanceof Error ? error.message : String(error);
      this.states.set(config.name, {
        config,
        status: 'error',
        tools: [],
        error: message,
      });
      bus.emit('mcp:server-error', { serverName: config.name, error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private async disconnectServer(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    const existing = this.states.get(serverName);
    const config = this.configs.get(serverName);

    if (!config) {
      return;
    }

    if (client) {
      try {
        await client.disconnect();
      } catch (error) {
        logger.debug(
          `[mcp:${serverName}] disconnect failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.clients.delete(serverName);
    this.states.set(serverName, {
      config,
      status: 'disconnected',
      tools: existing?.tools ?? [],
      connectedAt: existing?.connectedAt,
    });
    bus.emit('mcp:server-disconnected', { serverName });
  }
}
