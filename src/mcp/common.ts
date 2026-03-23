import type { McpServerConfig } from './types.ts';

export interface McpTransport {
  connect(): Promise<void>;
  send(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_CLIENT_INFO = {
  name: 'iriscode',
  version: '0.1.0',
} as const;

export function buildInitializeParams() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {},
    },
    clientInfo: MCP_CLIENT_INFO,
  };
}

export function getStartupTimeoutMs(config: McpServerConfig): number {
  return (config.startup_timeout_sec ?? 10) * 1000;
}

export function getToolTimeoutMs(config: McpServerConfig): number {
  return (config.tool_timeout_sec ?? 60) * 1000;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function normalizeToolName(value: string): string {
  return value.trim();
}
