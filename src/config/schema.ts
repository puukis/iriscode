import {
  DEFAULT_PERMISSION_MODE,
  normalizePermissionMode,
} from '../permissions/modes.ts';
import type { PermissionMode } from '../permissions/types.ts';

export interface IrisConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  groqApiKey?: string;
  mistralApiKey?: string;
  deepseekApiKey?: string;
  xaiApiKey?: string;
  perplexityApiKey?: string;
  togetherApiKey?: string;
  fireworksApiKey?: string;
  cohereApiKey?: string;
  openrouterApiKey?: string;
  ollamaBaseUrl?: string;
  defaultModel: string;
  logLevel: string;
  mode?: PermissionMode;
  allowed_tools?: string[];
  disallowed_tools?: string[];
}

export const DEFAULT_CONFIG: IrisConfig = {
  defaultModel: 'anthropic/claude-sonnet-4-6',
  logLevel: 'warn',
  mode: DEFAULT_PERMISSION_MODE,
};

export function parseConfigObject(input: Record<string, unknown>): Partial<IrisConfig> {
  return compactObject<IrisConfig>({
    anthropicApiKey: pickString(input, ['anthropicApiKey', 'anthropic_api_key']),
    openaiApiKey: pickString(input, ['openaiApiKey', 'openai_api_key']),
    googleApiKey: pickString(input, ['googleApiKey', 'google_api_key']),
    groqApiKey: pickString(input, ['groqApiKey', 'groq_api_key']),
    mistralApiKey: pickString(input, ['mistralApiKey', 'mistral_api_key']),
    deepseekApiKey: pickString(input, ['deepseekApiKey', 'deepseek_api_key']),
    xaiApiKey: pickString(input, ['xaiApiKey', 'xai_api_key']),
    perplexityApiKey: pickString(input, ['perplexityApiKey', 'perplexity_api_key']),
    togetherApiKey: pickString(input, ['togetherApiKey', 'together_api_key']),
    fireworksApiKey: pickString(input, ['fireworksApiKey', 'fireworks_api_key']),
    cohereApiKey: pickString(input, ['cohereApiKey', 'cohere_api_key']),
    openrouterApiKey: pickString(input, ['openrouterApiKey', 'openrouter_api_key']),
    ollamaBaseUrl: pickString(input, ['ollamaBaseUrl', 'ollama_base_url']),
    defaultModel: pickString(input, ['defaultModel', 'default_model']),
    logLevel: pickString(input, ['logLevel', 'log_level']),
    mode: normalizePermissionMode(
      pickFirst(input, ['mode', 'permission_mode']),
    ),
    allowed_tools: pickStringArray(input, ['allowed_tools', 'allowedTools']),
    disallowed_tools: pickStringArray(input, ['disallowed_tools', 'disallowedTools']),
  });
}

function pickFirst(input: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in input) {
      return input[key];
    }
  }

  return undefined;
}

function pickString(input: Record<string, unknown>, keys: string[]): string | undefined {
  const value = pickFirst(input, keys);
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function pickStringArray(input: Record<string, unknown>, keys: string[]): string[] | undefined {
  const value = pickFirst(input, keys);
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function compactObject<T extends object>(input: Partial<T>): Partial<T> {
  const result: Partial<T> = {};

  for (const [key, value] of Object.entries(input) as Array<[keyof T, T[keyof T] | undefined]>) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}
