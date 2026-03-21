import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { parse as parseDotenv } from 'dotenv';
import { loadGlobalConfigSync } from './global.ts';
import type { GlobalConfig, ProviderName } from './schema.ts';

export const PROVIDER_ENV_VARS: Record<Exclude<ProviderName, 'ollama'>, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  xai: 'XAI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  together: 'TOGETHER_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  cohere: 'COHERE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

export type SecretsMap = {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GROQ_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  XAI_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
  TOGETHER_API_KEY?: string;
  FIREWORKS_API_KEY?: string;
  COHERE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
};

let cachedSecrets: SecretsMap | null = null;

export async function loadSecrets(cwd: string): Promise<SecretsMap> {
  const absoluteCwd = resolve(cwd);
  const globalConfig = loadGlobalConfigSync().config;

  const resolved: SecretsMap = {};
  applyInlineProviderKeys(resolved, globalConfig);
  applyEnvFile(resolved, resolve(process.env.HOME ?? homedir(), '.iris', '.env'));
  applyEnvFile(resolved, resolve(absoluteCwd, '.env.local'));
  applyEnvFile(resolved, resolve(absoluteCwd, '.env'));
  applyShellEnv(resolved);

  cachedSecrets = resolved;
  return { ...resolved };
}

export function getApiKey(provider: string): string | undefined {
  const envVar = PROVIDER_ENV_VARS[provider as keyof typeof PROVIDER_ENV_VARS];
  if (!envVar || !cachedSecrets) {
    return undefined;
  }

  return cachedSecrets[envVar as keyof SecretsMap];
}

export async function setApiKey(provider: string, key: string): Promise<void> {
  const providerName = provider as ProviderName;
  if (providerName === 'ollama' || !(providerName in PROVIDER_ENV_VARS)) {
    throw new Error(`Unknown API-key provider "${provider}"`);
  }

  const { writeGlobalConfig } = await import('./global.ts');
  const current = loadGlobalConfigSync().config;
  const nextProviders = {
    ...(current.providers ?? {}),
    [providerName]: {
      ...(current.providers?.[providerName] ?? {}),
      apiKey: key.trim() || undefined,
    },
  };

  writeGlobalConfig({
    ...current,
    providers: nextProviders,
  });

  if (cachedSecrets) {
    const envVar = PROVIDER_ENV_VARS[providerName];
    if (key.trim()) {
      cachedSecrets[envVar as keyof SecretsMap] = key.trim();
    } else {
      delete cachedSecrets[envVar as keyof SecretsMap];
    }
  }
}

function applyInlineProviderKeys(target: SecretsMap, config: Partial<GlobalConfig>): void {
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_VARS) as Array<[Exclude<ProviderName, 'ollama'>, string]>) {
    const value = config.providers?.[provider]?.apiKey;
    if (value) {
      target[envVar as keyof SecretsMap] = value;
    }
  }
}

function applyEnvFile(target: SecretsMap, filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  try {
    const parsed = parseDotenv(readFileSync(filePath, 'utf-8'));
    for (const envVar of Object.values(PROVIDER_ENV_VARS)) {
      const value = parsed[envVar];
      if (typeof value === 'string' && value.trim()) {
        target[envVar as keyof SecretsMap] = value.trim();
      }
    }
  } catch {
    // Ignore malformed env files here; config loader handles surfaced validation separately.
  }
}

function applyShellEnv(target: SecretsMap): void {
  for (const envVar of Object.values(PROVIDER_ENV_VARS)) {
    const value = process.env[envVar];
    if (value && value.trim()) {
      target[envVar as keyof SecretsMap] = value.trim();
    }
  }
}
