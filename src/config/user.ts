import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { IrisConfig } from './schema.ts';
import { parseConfigObject } from './schema.ts';

const USER_CONFIG_DIR = '.iris';
const USER_CONFIG_FILE = 'config.toml';

export function ensureUserConfigDir(): string {
  const dir = join(process.env.HOME ?? homedir(), USER_CONFIG_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getUserConfigPath(): string {
  return join(ensureUserConfigDir(), USER_CONFIG_FILE);
}

export function loadUserConfig(): Partial<IrisConfig> {
  const configPath = getUserConfigPath();
  if (!existsSync(configPath)) {
    return {};
  }

  let content = '';
  try {
    content = readFileSync(configPath, 'utf-8');
  } catch {
    return {};
  }

  return parseConfigObject(parseSimpleToml(content));
}

export function writeUserConfig(config: Partial<IrisConfig>): void {
  const configPath = getUserConfigPath();
  const lines: string[] = [];

  appendString(lines, 'default_model', config.defaultModel);
  appendString(lines, 'log_level', config.logLevel);
  appendString(lines, 'mode', config.mode);
  appendArray(lines, 'allowed_tools', config.allowed_tools);
  appendArray(lines, 'disallowed_tools', config.disallowed_tools);
  appendString(lines, 'anthropic_api_key', config.anthropicApiKey);
  appendString(lines, 'openai_api_key', config.openaiApiKey);
  appendString(lines, 'google_api_key', config.googleApiKey);
  appendString(lines, 'groq_api_key', config.groqApiKey);
  appendString(lines, 'mistral_api_key', config.mistralApiKey);
  appendString(lines, 'deepseek_api_key', config.deepseekApiKey);
  appendString(lines, 'xai_api_key', config.xaiApiKey);
  appendString(lines, 'perplexity_api_key', config.perplexityApiKey);
  appendString(lines, 'together_api_key', config.togetherApiKey);
  appendString(lines, 'fireworks_api_key', config.fireworksApiKey);
  appendString(lines, 'cohere_api_key', config.cohereApiKey);
  appendString(lines, 'openrouter_api_key', config.openrouterApiKey);
  appendString(lines, 'ollama_base_url', config.ollamaBaseUrl);

  writeFileSync(configPath, `${lines.join('\n')}\n`, 'utf-8');
}

function parseSimpleToml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const line of content.split('\n')) {
    const withoutComment = stripInlineComment(line).trim();
    if (!withoutComment || withoutComment.startsWith('[')) {
      continue;
    }

    const separatorIndex = withoutComment.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = withoutComment.slice(0, separatorIndex).trim();
    const rawValue = withoutComment.slice(separatorIndex + 1).trim();
    if (!key || !rawValue) {
      continue;
    }

    result[key] = parseTomlValue(rawValue);
  }

  return result;
}

function parseTomlValue(value: string): unknown {
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }

    return inner
      .split(',')
      .map((item) => item.trim())
      .map((item) => unquote(item))
      .filter(Boolean);
  }

  return unquote(value);
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim();
}

function stripInlineComment(line: string): string {
  let inQuotes = false;
  let quoteChar = '';

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if ((char === '"' || char === '\'') && (!inQuotes || quoteChar === char)) {
      if (inQuotes && quoteChar === char) {
        inQuotes = false;
        quoteChar = '';
      } else if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      }
    }

    if (char === '#' && !inQuotes) {
      return line.slice(0, index);
    }
  }

  return line;
}

function appendString(lines: string[], key: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  lines.push(`${key} = "${escapeTomlString(value)}"`);
}

function appendArray(lines: string[], key: string, value: string[] | undefined): void {
  if (!value || value.length === 0) {
    return;
  }

  const items = value.map((entry) => `"${escapeTomlString(entry)}"`).join(', ');
  lines.push(`${key} = [${items}]`);
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
