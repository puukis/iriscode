import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface IrisConfig {
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  defaultModel: string;
  logLevel: string;
}

/**
 * Load .env file from the given path if it exists.
 * Parses KEY=VALUE lines, ignoring comments and blank lines.
 * Does NOT override existing process.env values.
 */
function loadDotEnv(envPath: string): void {
  let content: string;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    return; // file doesn't exist — skip
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

/**
 * Load configuration from environment variables and .env file.
 * Looks for .env in cwd, then in the directory containing the entry point.
 */
export function loadConfig(): IrisConfig {
  // Try to load .env from cwd
  loadDotEnv(resolve(process.cwd(), '.env'));

  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    defaultModel: process.env.IRISCODE_DEFAULT_MODEL ?? 'anthropic/claude-sonnet-4-6',
    logLevel: process.env.LOG_LEVEL ?? 'warn',
  };
}
