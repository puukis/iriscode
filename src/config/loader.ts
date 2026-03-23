import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseDotenv } from 'dotenv';
import type { ProviderName, ResolvedConfig } from './schema.ts';
import { defaults, PROVIDER_NAMES, ResolvedConfigSchema } from './schema.ts';
import { loadGlobalConfig } from './global.ts';
import { loadProjectConfig } from './project.ts';
import { PROVIDER_ENV_VARS, type SecretsMap, loadSecrets } from './secrets.ts';
import {
  formatValidationError,
  isPlainObject,
  mergeConfigObjects,
} from './utils.ts';

let cachedConfig: ResolvedConfig | null = null;
let cachedCwd: string | null = null;

export async function loadConfig(cwd: string = process.cwd()): Promise<ResolvedConfig> {
  const absoluteCwd = resolve(cwd);
  if (cachedConfig && cachedCwd === absoluteCwd) {
    return cachedConfig;
  }

  return reloadConfig(absoluteCwd);
}

export function getConfig(): ResolvedConfig {
  if (!cachedConfig) {
    throw new Error('Config has not been loaded yet. Call loadConfig() first.');
  }

  return cachedConfig;
}

export async function reloadConfig(cwd: string = process.cwd()): Promise<ResolvedConfig> {
  const absoluteCwd = resolve(cwd);

  try {
    const [globalInput, projectInput, secrets] = await Promise.all([
      loadGlobalConfig(),
      loadProjectConfig(absoluteCwd),
      loadSecrets(absoluteCwd),
    ]);

    const merged = mergeConfigObjects(
      mergeConfigObjects(
        mergeConfigObjects(
          globalConfigToMergeShape(globalInput.config),
          projectConfigToMergeShape(projectInput.config),
        ),
        secretsToMergeShape(secrets),
      ),
      envOverridesToMergeShape(absoluteCwd),
    );

    const candidate: ResolvedConfig = {
      default_model: stringOrDefault(merged.default_model, defaults.default_model),
      model: stringOrDefault(merged.model, stringOrDefault(merged.default_model, defaults.default_model)),
      providers: resolveProviders(merged.providers),
      permissions: resolvePermissions(merged.permissions),
      memory: resolveMemory(merged.memory),
      mcp_servers: resolveMcpServers(mergeMcpServerInputs(
        globalInput.config.mcp_servers,
        projectInput.config.mcp_servers,
      )),
      mcp_oauth_callback_port: numberOrDefault(
        merged.mcp_oauth_callback_port,
        defaults.mcp_oauth_callback_port,
      ),
      ...(stringOrUndefined(merged.mcp_oauth_callback_url)
        ? { mcp_oauth_callback_url: stringOrUndefined(merged.mcp_oauth_callback_url) }
        : {}),
      context_text: [globalInput.contextText, projectInput.contextText]
        .filter((part) => typeof part === 'string' && part.length > 0)
        .join('\n\n'),
      log_level: stringOrDefault(merged.log_level, defaults.log_level),
      vim_mode: booleanOrDefault(merged.vim_mode, defaults.vim_mode),
      notifications: notificationModeOrDefault(merged.notifications, defaults.notifications),
      shown_splash: booleanOrDefault(merged.shown_splash, defaults.shown_splash),
    };

    const validation = ResolvedConfigSchema.safeParse(candidate);
    if (!validation.success) {
      const message = formatValidationError('Resolved config', validation.error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      throw new Error(message);
    }

    applyResolvedConfigToProcessEnv(validation.data);
    cachedConfig = validation.data;
    cachedCwd = absoluteCwd;
    return validation.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    throw error instanceof Error ? error : new Error(message);
  }
}

function globalConfigToMergeShape(input: Record<string, unknown>): Record<string, unknown> {
  return isPlainObject(input) ? input : {};
}

function projectConfigToMergeShape(input: Record<string, unknown>): Record<string, unknown> {
  return isPlainObject(input) ? input : {};
}

function secretsToMergeShape(secrets: SecretsMap): Record<string, unknown> {
  const providers: Record<string, unknown> = {};

  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_VARS) as Array<[Exclude<ProviderName, 'ollama'>, string]>) {
    const value = secrets[envVar as keyof SecretsMap];
    if (!value) {
      continue;
    }

    providers[provider] = {
      ...(isPlainObject(providers[provider]) ? providers[provider] : {}),
      apiKey: value,
    };
  }

  return { providers };
}

function envOverridesToMergeShape(cwd: string): Record<string, unknown> {
  const fileOverrides = loadFileEnvOverrides(cwd);
  const providers: Record<string, unknown> = {};

  for (const provider of PROVIDER_NAMES) {
    const envVar = `${provider.toUpperCase()}_BASE_URL`;
    const baseUrl = process.env[envVar] ?? fileOverrides[envVar];
    if (baseUrl && baseUrl.trim()) {
      providers[provider] = {
        ...(isPlainObject(providers[provider]) ? providers[provider] : {}),
        baseUrl: baseUrl.trim(),
      };
    }
  }

  const explicitOllamaBaseUrl = process.env.OLLAMA_BASE_URL ?? fileOverrides.OLLAMA_BASE_URL;
  if (explicitOllamaBaseUrl && explicitOllamaBaseUrl.trim()) {
    providers.ollama = {
      ...(isPlainObject(providers.ollama) ? providers.ollama : {}),
      baseUrl: explicitOllamaBaseUrl.trim(),
    };
  }

  return {
    ...((process.env.IRISCODE_DEFAULT_MODEL ?? fileOverrides.IRISCODE_DEFAULT_MODEL)
      ? { default_model: (process.env.IRISCODE_DEFAULT_MODEL ?? fileOverrides.IRISCODE_DEFAULT_MODEL)?.trim() }
      : {}),
    ...((process.env.IRISCODE_MODEL ?? fileOverrides.IRISCODE_MODEL)
      ? { model: (process.env.IRISCODE_MODEL ?? fileOverrides.IRISCODE_MODEL)?.trim() }
      : {}),
    ...((process.env.LOG_LEVEL ?? fileOverrides.LOG_LEVEL)
      ? { log_level: (process.env.LOG_LEVEL ?? fileOverrides.LOG_LEVEL)?.trim() }
      : {}),
    ...(Object.keys(providers).length > 0 ? { providers } : {}),
  };
}

function resolveProviders(input: unknown): ResolvedConfig['providers'] {
  const source = isPlainObject(input) ? input : {};
  const result = {} as ResolvedConfig['providers'];

  for (const provider of PROVIDER_NAMES) {
    const providerConfig = isPlainObject(source[provider]) ? source[provider] : {};
    result[provider] = {
      apiKey: stringOrNull(providerConfig.apiKey, defaults.providers[provider].apiKey),
      baseUrl: stringOrNull(providerConfig.baseUrl, defaults.providers[provider].baseUrl),
    };
  }

  return result;
}

function resolvePermissions(input: unknown): ResolvedConfig['permissions'] {
  const source = isPlainObject(input) ? input : {};
  return {
    mode: source.mode === 'default' || source.mode === 'acceptEdits' || source.mode === 'plan'
      ? source.mode
      : defaults.permissions.mode,
    allowed_tools: arrayOfStrings(source.allowed_tools),
    disallowed_tools: arrayOfStrings(source.disallowed_tools),
  };
}

function resolveMemory(input: unknown): ResolvedConfig['memory'] {
  const source = isPlainObject(input) ? input : {};
  return {
    max_tokens: numberOrDefault(source.max_tokens, defaults.memory.max_tokens),
    max_lines: numberOrDefault(source.max_lines, defaults.memory.max_lines),
    warn_at: numberOrDefault(source.warn_at, defaults.memory.warn_at),
  };
}

function resolveMcpServers(input: unknown): ResolvedConfig['mcp_servers'] {
  if (!Array.isArray(input)) {
    return [];
  }

  const byName = new Map<string, ResolvedConfig['mcp_servers'][number]>();
  for (const entry of input) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const type = entry.type === 'stdio' || entry.type === 'http' ? entry.type : undefined;
    if (!name || !type) {
      continue;
    }

    byName.set(name, {
      name,
      type,
      command: typeof entry.command === 'string' && entry.command.trim() ? entry.command.trim() : undefined,
      args: Array.isArray(entry.args)
        ? entry.args.filter((arg): arg is string => typeof arg === 'string').map((arg) => arg.trim()).filter(Boolean)
        : [],
      url: typeof entry.url === 'string' && entry.url.trim() ? entry.url.trim() : undefined,
      bearer_token_env_var: typeof entry.bearer_token_env_var === 'string' && entry.bearer_token_env_var.trim()
        ? entry.bearer_token_env_var.trim()
        : undefined,
      http_headers: stringRecordOrUndefined(entry.http_headers),
      env_http_headers: stringRecordOrUndefined(entry.env_http_headers),
      startup_timeout_sec: numberOrDefault(entry.startup_timeout_sec, 10),
      tool_timeout_sec: numberOrDefault(entry.tool_timeout_sec, 60),
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
      required: typeof entry.required === 'boolean' ? entry.required : false,
    });
  }

  return Array.from(byName.values());
}

function applyResolvedConfigToProcessEnv(config: ResolvedConfig): void {
  process.env.IRISCODE_DEFAULT_MODEL = config.default_model;
  process.env.LOG_LEVEL = config.log_level;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stringOrNull(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function notificationModeOrDefault(
  value: unknown,
  fallback: ResolvedConfig['notifications'],
): ResolvedConfig['notifications'] {
  return value === 'iterm2' || value === 'bell' || value === 'off'
    ? value
    : fallback;
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeMcpServerInputs(...values: unknown[]): unknown[] {
  const merged: unknown[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      merged.push(...value);
    }
  }
  return merged;
}

function stringRecordOrUndefined(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const result = Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
      .map(([key, entry]) => [key, entry.trim()]),
  );

  return Object.keys(result).length > 0 ? result : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function resetConfigCacheForTests(): void {
  cachedConfig = null;
  cachedCwd = null;
}

function loadFileEnvOverrides(cwd: string): Record<string, string> {
  const merged: Record<string, string> = {};

  for (const filePath of [resolve(cwd, '.env.local'), resolve(cwd, '.env')]) {
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      Object.assign(merged, parseDotenv(readFileSync(filePath, 'utf-8')));
    } catch {
      // Ignore malformed env override files here; secrets/config validation surfaces user-facing issues elsewhere.
    }
  }

  return merged;
}
