import { McpConnectionError } from '../shared/errors.ts';
import { logger } from '../shared/logger.ts';
import {
  buildInitializeParams,
  getStartupTimeoutMs,
  getToolTimeoutMs,
  isPlainObject,
  withTimeout,
  type McpTransport,
} from './common.ts';
import { HttpTransport } from './transports/http.ts';
import { StdioTransport } from './transports/stdio.ts';
import type { McpCallResult, McpServerConfig, McpTool } from './types.ts';

export class McpClient {
  private readonly config: McpServerConfig;
  private readonly transport: McpTransport;
  private tools: McpTool[] = [];

  constructor(config: McpServerConfig) {
    this.config = config;
    this.transport = config.type === 'http'
      ? new HttpTransport(config)
      : new StdioTransport(config);
  }

  async initialize(): Promise<McpTool[]> {
    try {
      await this.transport.connect();

      if (this.config.type === 'stdio') {
        await withTimeout(
          this.transport.send('initialize', buildInitializeParams()),
          getStartupTimeoutMs(this.config),
          () => new McpConnectionError(
            `Timed out after ${this.config.startup_timeout_sec ?? 10}s while initializing server.`,
            this.config.name,
          ),
        );
        await this.transport.notify('notifications/initialized');
      }

      const payload = await withTimeout(
        this.transport.send('tools/list'),
        getStartupTimeoutMs(this.config),
        () => new McpConnectionError(
          `Timed out after ${this.config.startup_timeout_sec ?? 10}s while listing tools.`,
          this.config.name,
        ),
      );

      this.tools = normalizeTools(payload, this.config.name);
      return [...this.tools];
    } catch (error) {
      await this.transport.disconnect().catch(() => {});
      throw error;
    }
  }

  async callTool(toolName: string, input: Record<string, unknown>): Promise<McpCallResult> {
    try {
      const payload = await withTimeout(
        this.transport.send('tools/call', {
          name: toolName,
          arguments: input,
        }),
        getToolTimeoutMs(this.config),
        () => new McpConnectionError(
          `Tool call timed out after ${this.config.tool_timeout_sec ?? 60}s`,
          this.config.name,
        ),
      );

      return normalizeCallResult(payload);
    } catch (error) {
      if (error instanceof McpConnectionError && error.message.includes('timed out')) {
        return {
          isError: true,
          content: [{ type: 'error', text: `Tool call timed out after ${this.config.tool_timeout_sec ?? 60}s` }],
        };
      }

      logger.debug(
        `[mcp:${this.config.name}] tool call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        isError: true,
        content: [{
          type: 'error',
          text: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  async disconnect(): Promise<void> {
    this.tools = [];
    await this.transport.disconnect();
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  getTools(): McpTool[] {
    return [...this.tools];
  }
}

function normalizeTools(payload: unknown, serverName: string): McpTool[] {
  const source = Array.isArray(payload)
    ? payload
    : isPlainObject(payload) && Array.isArray(payload.tools)
      ? payload.tools
      : [];

  return source
    .map((entry) => {
      if (!isPlainObject(entry) || typeof entry.name !== 'string') {
        return null;
      }

      return {
        name: entry.name.trim(),
        description: typeof entry.description === 'string' ? entry.description : '',
        inputSchema: normalizeInputSchema(entry.inputSchema, entry.input_schema),
        serverName,
      } satisfies McpTool;
    })
    .filter((entry): entry is McpTool => entry !== null && entry.name.length > 0);
}

function normalizeInputSchema(...candidates: unknown[]): McpTool['inputSchema'] {
  for (const candidate of candidates) {
    if (
      isPlainObject(candidate)
      && candidate.type === 'object'
      && isPlainObject(candidate.properties)
    ) {
      return {
        ...candidate,
        type: 'object',
        properties: candidate.properties,
        ...(Array.isArray(candidate.required)
          ? {
              required: candidate.required
                .filter((entry): entry is string => typeof entry === 'string'),
            }
          : {}),
      };
    }
  }

  return {
    type: 'object',
    properties: {},
  };
}

function normalizeCallResult(payload: unknown): McpCallResult {
  if (isPlainObject(payload) && isPlainObject(payload.redirect)) {
    return {
      isError: true,
      content: [{
        type: 'error',
        text: `Cross-host redirect blocked: ${String(payload.redirect.location ?? 'unknown location')}`,
      }],
    };
  }

  if (isPlainObject(payload) && Array.isArray(payload.content)) {
    const content = payload.content
      .map((entry) => {
        if (!isPlainObject(entry) || typeof entry.text !== 'string') {
          return null;
        }
        const type = entry.type === 'error' ? 'error' : 'text';
        return { type, text: entry.text } as McpCallResult['content'][number];
      })
      .filter((entry): entry is McpCallResult['content'][number] => entry !== null);

    return {
      content: content.length > 0 ? content : [{ type: 'text', text: '' }],
      isError: payload.isError === true || content.some((entry) => entry.type === 'error'),
    };
  }

  if (typeof payload === 'string') {
    return {
      isError: false,
      content: [{ type: 'text', text: payload }],
    };
  }

  return {
    isError: false,
    content: [{
      type: 'text',
      text: payload === null ? '' : JSON.stringify(payload, null, 2),
    }],
  };
}
