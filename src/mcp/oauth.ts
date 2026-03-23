import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { spawn } from 'child_process';
import { loadGlobalConfigSync } from '../config/global.ts';
import { isPlainObject } from './common.ts';

interface StoredAuthFile {
  mcp_tokens?: Record<string, StoredToken>;
}

interface OAuthMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  issuer?: string;
  scopes_supported?: string[];
}

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
  token_endpoint?: string;
  client_id?: string;
  redirect_uri?: string;
}

const AUTH_FILE = 'auth.json';

export async function mcpLogin(serverName: string, serverUrl: string): Promise<string> {
  const metadata = await fetchOAuthMetadata(serverUrl);
  const globalConfig = loadGlobalConfigSync().config;
  const callbackPort = globalConfig.mcp_oauth_callback_port ?? 5555;
  const callbackUrl = globalConfig.mcp_oauth_callback_url?.trim() || `http://localhost:${callbackPort}/callback`;
  const callbackHost = globalConfig.mcp_oauth_callback_url ? '0.0.0.0' : '127.0.0.1';
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  const clientId = await ensureClientId(serverName, metadata, callbackUrl);
  const authorizationUrl = new URL(metadata.authorization_endpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', callbackUrl);
  authorizationUrl.searchParams.set('code_challenge', codeChallenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  authorizationUrl.searchParams.set('state', state);

  const scope = metadata.scopes_supported?.includes('openid')
    ? 'openid'
    : metadata.scopes_supported?.join(' ');
  if (scope) {
    authorizationUrl.searchParams.set('scope', scope);
  }

  const code = await waitForOAuthCode({
    callbackHost,
    callbackPort: new URL(callbackUrl).port
      ? Number(new URL(callbackUrl).port)
      : callbackPort,
    callbackUrl,
    authorizationUrl: authorizationUrl.toString(),
    expectedState: state,
  });

  const tokenPayload = await exchangeAuthorizationCode({
    code,
    clientId,
    redirectUri: callbackUrl,
    codeVerifier,
    tokenEndpoint: metadata.token_endpoint,
  });

  const stored = toStoredToken(tokenPayload, {
    tokenEndpoint: metadata.token_endpoint,
    clientId,
    redirectUri: callbackUrl,
  });
  writeStoredToken(serverName, stored);
  return stored.access_token;
}

export function getStoredToken(serverName: string): string | undefined {
  return readAuthFile().mcp_tokens?.[serverName]?.access_token;
}

export async function refreshTokenIfNeeded(serverName: string): Promise<string | undefined> {
  const authFile = readAuthFile();
  const stored = authFile.mcp_tokens?.[serverName];
  if (!stored?.access_token) {
    return undefined;
  }

  if (!stored.expires_at || stored.expires_at - Date.now() > 5 * 60 * 1000) {
    return stored.access_token;
  }

  if (!stored.refresh_token || !stored.token_endpoint || !stored.client_id) {
    return stored.access_token;
  }

  const response = await fetch(stored.token_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
      client_id: stored.client_id,
    }),
  });

  if (!response.ok) {
    return stored.access_token;
  }

  const payload = await response.json() as Record<string, unknown>;
  const refreshed = toStoredToken(payload, {
    tokenEndpoint: stored.token_endpoint,
    clientId: stored.client_id,
    redirectUri: stored.redirect_uri,
    fallbackRefreshToken: stored.refresh_token,
  });
  writeStoredToken(serverName, refreshed);
  return refreshed.access_token;
}

async function fetchOAuthMetadata(serverUrl: string): Promise<OAuthMetadata> {
  const candidates = [
    new URL('./.well-known/oauth-authorization-server', ensureTrailingSlash(serverUrl)).toString(),
    `${new URL(serverUrl).origin}/.well-known/oauth-authorization-server`,
  ];

  let lastError: Error | undefined;
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        lastError = new Error(`OAuth metadata request failed with ${response.status}`);
        continue;
      }

      const payload = await response.json() as Record<string, unknown>;
      if (
        typeof payload.authorization_endpoint !== 'string'
        || typeof payload.token_endpoint !== 'string'
      ) {
        lastError = new Error('OAuth metadata is missing required endpoints.');
        continue;
      }

      return {
        authorization_endpoint: payload.authorization_endpoint,
        token_endpoint: payload.token_endpoint,
        registration_endpoint: typeof payload.registration_endpoint === 'string' ? payload.registration_endpoint : undefined,
        issuer: typeof payload.issuer === 'string' ? payload.issuer : undefined,
        scopes_supported: Array.isArray(payload.scopes_supported)
          ? payload.scopes_supported.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error(`Unable to load OAuth metadata for ${serverUrl}`);
}

async function ensureClientId(
  serverName: string,
  metadata: OAuthMetadata,
  redirectUri: string,
): Promise<string> {
  const existing = readAuthFile().mcp_tokens?.[serverName]?.client_id;
  if (existing) {
    return existing;
  }

  if (!metadata.registration_endpoint) {
    return 'iriscode';
  }

  try {
    const response = await fetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_name: 'IrisCode',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });

    if (!response.ok) {
      return 'iriscode';
    }

    const payload = await response.json() as Record<string, unknown>;
    return typeof payload.client_id === 'string' && payload.client_id.trim()
      ? payload.client_id
      : 'iriscode';
  } catch {
    return 'iriscode';
  }
}

async function waitForOAuthCode(options: {
  callbackHost: string;
  callbackPort: number;
  callbackUrl: string;
  authorizationUrl: string;
  expectedState: string;
}): Promise<string> {
  const codePromise = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        if (!req.url) {
          throw new Error('OAuth callback request was missing a URL.');
        }

        const requestUrl = new URL(req.url, options.callbackUrl);
        const code = requestUrl.searchParams.get('code');
        const state = requestUrl.searchParams.get('state');

        if (!code) {
          throw new Error('OAuth callback did not include an authorization code.');
        }
        if (state !== options.expectedState) {
          throw new Error('OAuth callback state did not match the authorization request.');
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('IrisCode OAuth login complete. You can return to the terminal.');
        server.close(() => resolve(code));
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('OAuth login failed. You can close this window.');
        server.close(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });

    server.listen(options.callbackPort, options.callbackHost);
  });

  openInBrowser(options.authorizationUrl);
  return codePromise;
}

async function exchangeAuthorizationCode(options: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  tokenEndpoint: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch(options.tokenEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      code_verifier: options.codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with status ${response.status}`);
  }

  return await response.json() as Record<string, unknown>;
}

function toStoredToken(
  payload: Record<string, unknown>,
  options: {
    tokenEndpoint: string;
    clientId: string;
    redirectUri?: string;
    fallbackRefreshToken?: string;
  },
): StoredToken {
  if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
    throw new Error('OAuth token response did not include an access_token.');
  }

  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : undefined;

  return {
    access_token: payload.access_token,
    refresh_token: typeof payload.refresh_token === 'string'
      ? payload.refresh_token
      : options.fallbackRefreshToken,
    expires_at: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    token_type: typeof payload.token_type === 'string' ? payload.token_type : undefined,
    scope: typeof payload.scope === 'string' ? payload.scope : undefined,
    token_endpoint: options.tokenEndpoint,
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
  };
}

function openInBrowser(url: string): void {
  const command = process.platform === 'darwin'
    ? ['open', url]
    : process.platform === 'win32'
      ? ['cmd', '/c', 'start', '', url]
      : ['xdg-open', url];

  const child = spawn(command[0], command.slice(1), {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function readAuthFile(): StoredAuthFile {
  const authPath = getAuthFilePath();
  if (!existsSync(authPath)) {
    return {};
  }

  try {
    const payload = JSON.parse(readFileSync(authPath, 'utf-8')) as unknown;
    if (!isPlainObject(payload)) {
      return {};
    }
    return payload as StoredAuthFile;
  } catch {
    return {};
  }
}

function writeStoredToken(serverName: string, token: StoredToken): void {
  const authPath = getAuthFilePath();
  mkdirSync(dirname(authPath), { recursive: true });
  const current = readAuthFile();
  const next: StoredAuthFile = {
    ...current,
    mcp_tokens: {
      ...(current.mcp_tokens ?? {}),
      [serverName]: token,
    },
  };
  writeFileSync(authPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
}

function getAuthFilePath(): string {
  return join(resolve(process.env.HOME ?? homedir(), '.iris'), AUTH_FILE);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
