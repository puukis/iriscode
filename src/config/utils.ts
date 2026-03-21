import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { ZodError } from 'zod';
import { PROVIDER_NAMES } from './schema.ts';

const API_KEY_ALIASES: Record<string, string[]> = {
  anthropic: ['anthropic_api_key', 'anthropicApiKey'],
  openai: ['openai_api_key', 'openaiApiKey'],
  google: ['google_api_key', 'googleApiKey'],
  groq: ['groq_api_key', 'groqApiKey'],
  mistral: ['mistral_api_key', 'mistralApiKey'],
  deepseek: ['deepseek_api_key', 'deepseekApiKey'],
  xai: ['xai_api_key', 'xaiApiKey'],
  perplexity: ['perplexity_api_key', 'perplexityApiKey'],
  together: ['together_api_key', 'togetherApiKey'],
  fireworks: ['fireworks_api_key', 'fireworksApiKey'],
  cohere: ['cohere_api_key', 'cohereApiKey'],
  openrouter: ['openrouter_api_key', 'openrouterApiKey'],
  ollama: [],
};

const BASE_URL_ALIASES: Record<string, string[]> = {
  anthropic: ['anthropic_base_url', 'anthropicBaseUrl'],
  openai: ['openai_base_url', 'openaiBaseUrl'],
  google: ['google_base_url', 'googleBaseUrl'],
  groq: ['groq_base_url', 'groqBaseUrl'],
  mistral: ['mistral_base_url', 'mistralBaseUrl'],
  deepseek: ['deepseek_base_url', 'deepseekBaseUrl'],
  xai: ['xai_base_url', 'xaiBaseUrl'],
  perplexity: ['perplexity_base_url', 'perplexityBaseUrl'],
  together: ['together_base_url', 'togetherBaseUrl'],
  fireworks: ['fireworks_base_url', 'fireworksBaseUrl'],
  cohere: ['cohere_base_url', 'cohereBaseUrl'],
  openrouter: ['openrouter_base_url', 'openrouterBaseUrl'],
  ollama: ['ollama_base_url', 'ollamaBaseUrl'],
};

export function ensureDirectory(path: string): string {
  const absolutePath = resolve(path);
  mkdirSync(absolutePath, { recursive: true });
  return absolutePath;
}

export function normalizeConfigInput(input: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    ...input,
  };

  const permissions = pickObject(normalized.permissions);
  const providers = pickObject(normalized.providers);

  const mode = pickFirstString(normalized, ['mode', 'permission_mode']);
  if (mode !== undefined) {
    permissions.mode = mode;
  }

  const allowedTools = pickStringArray(normalized, ['allowed_tools', 'allowedTools']);
  if (allowedTools !== undefined) {
    permissions.allowed_tools = allowedTools;
  }

  const blockedTools = pickStringArray(normalized, ['disallowed_tools', 'disallowedTools']);
  if (blockedTools !== undefined) {
    permissions.disallowed_tools = blockedTools;
  }

  for (const provider of PROVIDER_NAMES) {
    const nextProvider = pickObject(providers[provider]);
    const apiKey = pickFirstString(normalized, API_KEY_ALIASES[provider]);
    const baseUrl = pickFirstString(normalized, BASE_URL_ALIASES[provider]);

    if (apiKey !== undefined) {
      nextProvider.apiKey = apiKey;
    }
    if (baseUrl !== undefined) {
      nextProvider.baseUrl = baseUrl;
    }

    if (Object.keys(nextProvider).length > 0) {
      providers[provider] = nextProvider;
    }
  }

  const defaultModel = pickFirstString(normalized, ['default_model', 'defaultModel']);
  if (defaultModel !== undefined) {
    normalized.default_model = defaultModel;
  }

  const logLevel = pickFirstString(normalized, ['log_level', 'logLevel']);
  if (logLevel !== undefined) {
    normalized.log_level = logLevel;
  }

  if (Object.keys(permissions).length > 0) {
    normalized.permissions = permissions;
  }
  if (Object.keys(providers).length > 0) {
    normalized.providers = providers;
  }

  delete normalized.allowed_tools;
  delete normalized.allowedTools;
  delete normalized.disallowed_tools;
  delete normalized.disallowedTools;
  delete normalized.permission_mode;
  delete normalized.defaultModel;
  delete normalized.logLevel;

  for (const aliasList of Object.values(API_KEY_ALIASES)) {
    for (const alias of aliasList) {
      delete normalized[alias];
    }
  }
  for (const aliasList of Object.values(BASE_URL_ALIASES)) {
    for (const alias of aliasList) {
      delete normalized[alias];
    }
  }

  return normalized;
}

export function mergeConfigObjects<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    const previous = result[key];
    if (Array.isArray(value)) {
      result[key] = [...value];
      continue;
    }

    if (isPlainObject(previous) && isPlainObject(value)) {
      result[key] = mergeConfigObjects(previous, value);
      continue;
    }

    result[key] = value;
  }

  return result as T;
}

export function formatValidationError(label: string, error: unknown): string {
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `  - ${path}: ${issue.message}`;
    }).join('\n');
    return `${label} is invalid:\n${issues}`;
  }

  return `${label} is invalid: ${error instanceof Error ? error.message : String(error)}`;
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.toLowerCase().includes('apikey') || key.toLowerCase().includes('api_key')) {
      result[key] = entry ? '***' : entry;
      continue;
    }
    result[key] = redactSecrets(entry);
  }
  return result;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? { ...value } : {};
}

function pickFirstString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function pickStringArray(input: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = input[key];
    if (!Array.isArray(value)) {
      continue;
    }

    const normalized = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return normalized;
  }

  return undefined;
}
