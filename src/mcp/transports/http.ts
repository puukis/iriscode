import { randomUUID } from 'crypto';
import { McpConnectionError } from '../../shared/errors.ts';
import {
  MCP_CLIENT_INFO,
  buildInitializeParams,
  getStartupTimeoutMs,
  getToolTimeoutMs,
  isPlainObject,
  type JsonRpcFailure,
  type JsonRpcSuccess,
  type McpTransport,
} from '../common.ts';
import { getStoredToken, refreshTokenIfNeeded } from '../oauth.ts';
import type { McpServerConfig } from '../types.ts';

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

export class HttpTransport implements McpTransport {
  private readonly config: McpServerConfig;
  private connected = false;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const response = await this.postJson(
      '/initialize',
      buildInitializeParams(),
      getStartupTimeoutMs(this.config),
      false,
    );

    if (isRedirectMetadata(response)) {
      throw new McpConnectionError(
        `Cross-host redirect blocked during initialize: ${response.redirect.location}`,
        this.config.name,
      );
    }

    this.connected = true;
  }

  async send(method: string, params?: unknown): Promise<unknown> {
    if (!this.connected) {
      throw new McpConnectionError('HTTP server is not connected.', this.config.name);
    }

    const payload = {
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      ...(params === undefined ? {} : { params }),
    };

    const response = await this.postJson(
      '/message',
      payload,
      getToolTimeoutMs(this.config),
      true,
    );

    if (isRedirectMetadata(response)) {
      return response;
    }

    if (isJsonRpcFailure(response)) {
      throw new McpConnectionError(response.error.message, this.config.name, response.error);
    }

    if (isJsonRpcSuccess(response)) {
      return response.result;
    }

    return response;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.connected) {
      throw new McpConnectionError('HTTP server is not connected.', this.config.name);
    }

    await this.postJson(
      '/message',
      {
        jsonrpc: '2.0',
        method,
        ...(params === undefined ? {} : { params }),
      },
      getToolTimeoutMs(this.config),
      false,
    );
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.postJson('/shutdown', { clientInfo: MCP_CLIENT_INFO }, getStartupTimeoutMs(this.config), false);
    } catch {
      // Best-effort shutdown only.
    } finally {
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async postJson(
    path: string,
    body: unknown,
    timeoutMs: number,
    allowCrossHostMetadata: boolean,
  ): Promise<unknown> {
    if (!this.config.url) {
      throw new McpConnectionError('Missing HTTP server URL.', this.config.name);
    }

    let currentUrl = new URL(path.replace(/^\/+/, ''), appendTrailingSlash(this.config.url));

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetch(currentUrl, {
        method: 'POST',
        headers: await this.resolveHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });

      if (REDIRECT_STATUS_CODES.has(response.status)) {
        const locationHeader = response.headers.get('location');
        if (!locationHeader) {
          throw new McpConnectionError(
            `Redirect ${response.status} did not include a Location header.`,
            this.config.name,
          );
        }

        const nextUrl = new URL(locationHeader, currentUrl);
        if (nextUrl.origin !== currentUrl.origin) {
          if (!allowCrossHostMetadata) {
            throw new McpConnectionError(
              `Cross-host redirect blocked: ${nextUrl.toString()}`,
              this.config.name,
            );
          }
          return {
            redirect: {
              status: response.status,
              location: nextUrl.toString(),
            },
          };
        }

        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new McpConnectionError(
          `HTTP ${response.status}: ${bodyText || response.statusText}`,
          this.config.name,
        );
      }

      if (response.status === 204) {
        return null;
      }

      const text = await response.text();
      if (!text.trim()) {
        return null;
      }

      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new McpConnectionError(
          `Failed to parse HTTP response JSON: ${error instanceof Error ? error.message : String(error)}`,
          this.config.name,
          error,
        );
      }
    }

    throw new McpConnectionError(
      `Too many redirects while connecting to ${this.config.url}.`,
      this.config.name,
    );
  }

  private async resolveHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(this.config.http_headers ?? {}),
    };

    for (const [headerName, envVarName] of Object.entries(this.config.env_http_headers ?? {})) {
      const value = process.env[envVarName];
      if (typeof value === 'string' && value.trim()) {
        headers[headerName] = value.trim();
      }
    }

    const oauthToken =
      await refreshTokenIfNeeded(this.config.name)
      ?? getStoredToken(this.config.name);
    const bearerToken = oauthToken
      ?? (this.config.bearer_token_env_var
        ? process.env[this.config.bearer_token_env_var]
        : undefined);

    if (typeof bearerToken === 'string' && bearerToken.trim()) {
      headers.Authorization = `Bearer ${bearerToken.trim()}`;
    }

    return headers;
  }
}

function appendTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function isJsonRpcSuccess(value: unknown): value is JsonRpcSuccess {
  return isPlainObject(value) && value.jsonrpc === '2.0' && 'result' in value;
}

function isJsonRpcFailure(value: unknown): value is JsonRpcFailure {
  return isPlainObject(value) && value.jsonrpc === '2.0' && 'error' in value;
}

function isRedirectMetadata(value: unknown): value is { redirect: { status: number; location: string } } {
  return isPlainObject(value)
    && isPlainObject(value.redirect)
    && typeof value.redirect.status === 'number'
    && typeof value.redirect.location === 'string';
}
