import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loadProjectConfig } from './project.ts';
import { DEFAULT_CONFIG, type IrisConfig, parseConfigObject } from './schema.ts';
import { loadUserConfig } from './user.ts';

function loadDotEnv(envPath: string): void {
  let content: string;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    return;
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

export function loadConfig(cwd: string = process.cwd()): IrisConfig {
  loadDotEnv(resolve(cwd, '.env'));

  const userConfig = loadUserConfig();
  const projectConfig = loadProjectConfig(cwd);
  const envConfig = parseConfigObject({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    googleApiKey: process.env.GOOGLE_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
    mistralApiKey: process.env.MISTRAL_API_KEY,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    xaiApiKey: process.env.XAI_API_KEY,
    perplexityApiKey: process.env.PERPLEXITY_API_KEY,
    togetherApiKey: process.env.TOGETHER_API_KEY,
    fireworksApiKey: process.env.FIREWORKS_API_KEY,
    cohereApiKey: process.env.COHERE_API_KEY,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    defaultModel: process.env.IRISCODE_DEFAULT_MODEL,
    logLevel: process.env.LOG_LEVEL,
  });

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    ...projectConfig,
    ...envConfig,
  };
}
