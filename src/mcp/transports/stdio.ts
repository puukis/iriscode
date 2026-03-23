import { randomUUID } from 'crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { McpConnectionError } from '../../shared/errors.ts';
import { logger } from '../../shared/logger.ts';
import {
  type JsonRpcFailure,
  type JsonRpcResponse,
  type JsonRpcSuccess,
  type McpTransport,
  getStartupTimeoutMs,
  isPlainObject,
} from '../common.ts';
import type { McpServerConfig } from '../types.ts';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class StdioTransport implements McpTransport {
  private readonly config: McpServerConfig;
  private child: ChildProcessWithoutNullStreams | null = null;
  private connected = false;
  private stdoutBuffer = '';
  private readonly pending = new Map<string, PendingRequest>();

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.config.command) {
      throw new McpConnectionError('Missing stdio command.', this.config.name);
    }

    const startupTimeoutMs = getStartupTimeoutMs(this.config);

    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const child = spawn(this.config.command!, this.config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
        }
        child.off('spawn', handleSpawn);
        child.off('error', handleError);
      };

      const handleSpawn = () => {
        cleanup();
        this.child = child;
        this.connected = true;
        this.attachChildListeners(child);
        resolve();
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(new McpConnectionError(
          `Failed to start stdio server: ${error.message}`,
          this.config.name,
          error,
        ));
      };

      timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new McpConnectionError(
          `Timed out after ${startupTimeoutMs / 1000}s while starting stdio server.`,
          this.config.name,
        ));
      }, startupTimeoutMs);
      timer.unref?.();

      child.once('spawn', handleSpawn);
      child.once('error', handleError);
    });
  }

  async send(method: string, params?: unknown): Promise<unknown> {
    if (!this.child || !this.connected || this.child.stdin.destroyed) {
      throw new McpConnectionError('Stdio server is not connected.', this.config.name);
    }

    const id = randomUUID();
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params }),
    });

    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.child.stdin.write(`${payload}\n`);
    return response;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.child || !this.connected || this.child.stdin.destroyed) {
      throw new McpConnectionError('Stdio server is not connected.', this.config.name);
    }

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
    });

    this.child.stdin.write(`${payload}\n`);
  }

  async disconnect(): Promise<void> {
    if (!this.child) {
      this.connected = false;
      return;
    }

    try {
      if (!this.child.stdin.destroyed) {
        await this.notify('shutdown');
        this.child.stdin.end();
      }
    } catch {
      // Best-effort shutdown notification only.
    }

    const child = this.child;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      child.once('close', finish);
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGTERM');
        }
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
          finish();
        }, 250).unref?.();
      }, 250).unref?.();
    });

    this.handleChildTermination(new McpConnectionError('Stdio server disconnected.', this.config.name));
  }

  isConnected(): boolean {
    return this.connected;
  }

  private attachChildListeners(child: ChildProcessWithoutNullStreams): void {
    child.stdout.on('data', (chunk: Buffer | string) => {
      this.stdoutBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      const lines = this.stdoutBuffer.split(/\r?\n/);
      this.stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        this.handleStdoutLine(trimmed);
      }
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          logger.debug(`[mcp:${this.config.name}:stderr] ${line}`);
        }
      }
    });

    child.once('close', (code, signal) => {
      this.handleChildTermination(new McpConnectionError(
        `Stdio server exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (signal ${signal})` : ''}.`,
        this.config.name,
      ));
    });

    child.once('error', (error) => {
      this.handleChildTermination(new McpConnectionError(
        `Stdio server error: ${error.message}`,
        this.config.name,
        error,
      ));
    });
  }

  private handleStdoutLine(line: string): void {
    let message: JsonRpcResponse | Record<string, unknown>;
    try {
      message = JSON.parse(line) as JsonRpcResponse | Record<string, unknown>;
    } catch (error) {
      logger.debug(
        `[mcp:${this.config.name}:stdout] Failed to parse JSON-RPC line: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    if (!isPlainObject(message) || !('id' in message)) {
      return;
    }

    const id = message.id;
    if (typeof id !== 'string' && typeof id !== 'number') {
      return;
    }

    const pending = this.pending.get(String(id));
    if (!pending) {
      return;
    }

    this.pending.delete(String(id));

    if ('error' in message && isPlainObject(message.error)) {
      const failure = message as unknown as JsonRpcFailure;
      pending.reject(new McpConnectionError(
        failure.error.message,
        this.config.name,
        failure.error,
      ));
      return;
    }

    pending.resolve((message as unknown as JsonRpcSuccess).result);
  }

  private handleChildTermination(error: Error): void {
    if (!this.child && !this.connected && this.pending.size === 0) {
      return;
    }

    this.connected = false;
    this.stdoutBuffer = '';
    this.child = null;

    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}
