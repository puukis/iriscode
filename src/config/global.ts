import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { parse as parseToml, stringify as stringifyToml, TomlError } from 'smol-toml';
import { GlobalConfigSchema, type GlobalConfig } from './schema.ts';
import {
  ensureDirectory,
  formatValidationError,
  isPlainObject,
  normalizeConfigInput,
} from './utils.ts';
import { createLoadedContextFile, type LoadedContextFile } from './context-files.ts';

export const GLOBAL_CONFIG_DIR = '.iris';
export const GLOBAL_CONFIG_FILE = 'config.toml';
export const GLOBAL_CONTEXT_FILE = 'IRIS.md';
export const GLOBAL_ENV_FILE = '.env';

const DEFAULT_GLOBAL_CONFIG_TEMPLATE = `# IrisCode global configuration
# default_model = "anthropic/claude-sonnet-4-6"
# log_level = "warn"
#
# [permissions]
# mode = "default"
# allowed_tools = ["read", "glob", "grep"]
# disallowed_tools = []
#
# [providers.openai]
# apiKey = "sk-..."
`;

export interface LoadedGlobalConfig {
  config: GlobalConfig;
  contextText: string;
  contextFiles: LoadedContextFile[];
}

export async function loadGlobalConfig(): Promise<LoadedGlobalConfig> {
  return loadGlobalConfigSync();
}

export function loadGlobalConfigSync(): LoadedGlobalConfig {
  const configPath = getGlobalConfigPath();
  if (!existsSync(configPath)) {
    writeFileSync(configPath, DEFAULT_GLOBAL_CONFIG_TEMPLATE, 'utf-8');
  }

  const rawConfig = readGlobalConfigTomlSync(configPath);
  const validation = GlobalConfigSchema.safeParse(normalizeConfigInput(rawConfig));
  if (!validation.success) {
    throw new Error(formatValidationError(`Global config in ${configPath}`, validation.error));
  }

  return {
    config: validation.data,
    contextText: readGlobalContextTextSync(),
    contextFiles: loadGlobalContextFilesSync(),
  };
}

export function writeGlobalConfig(config: GlobalConfig): void {
  const configPath = getGlobalConfigPath();
  const payload = configToTomlShape(config);
  writeFileSync(configPath, stringifyToml(payload), 'utf-8');
}

export function getGlobalConfigPath(): string {
  return resolve(ensureDirectory(join(process.env.HOME ?? homedir(), GLOBAL_CONFIG_DIR)), GLOBAL_CONFIG_FILE);
}

export function getGlobalContextPath(): string {
  return resolve(ensureDirectory(join(process.env.HOME ?? homedir(), GLOBAL_CONFIG_DIR)), GLOBAL_CONTEXT_FILE);
}

export function getGlobalEnvPath(): string {
  return resolve(ensureDirectory(join(process.env.HOME ?? homedir(), GLOBAL_CONFIG_DIR)), GLOBAL_ENV_FILE);
}

function readGlobalConfigTomlSync(configPath: string): Record<string, unknown> {
  let content = '';
  try {
    content = readFileSync(configPath, 'utf-8');
  } catch {
    return {};
  }

  if (!content.trim()) {
    return {};
  }

  try {
    const parsed = parseToml(content);
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    if (error instanceof TomlError) {
      throw new Error(`Invalid TOML in ${configPath}:${error.line}:${error.column}: ${error.message}`);
    }
    throw error;
  }
}

function readGlobalContextTextSync(): string {
  const contextPath = getGlobalContextPath();
  if (!existsSync(contextPath)) {
    return '';
  }

  try {
    return readFileSync(contextPath, 'utf-8');
  } catch {
    return '';
  }
}

function loadGlobalContextFilesSync(): LoadedContextFile[] {
  const contextPath = getGlobalContextPath();
  if (!existsSync(contextPath)) {
    return [];
  }

  try {
    const content = readFileSync(contextPath, 'utf-8');
    const contextFile = createLoadedContextFile(contextPath, content);
    return contextFile ? [contextFile] : [];
  } catch {
    return [];
  }
}

function configToTomlShape(config: GlobalConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (config.default_model) {
    result.default_model = config.default_model;
  }
  if (config.log_level) {
    result.log_level = config.log_level;
  }
  if (config.permissions) {
    result.permissions = config.permissions;
  }
  if (config.providers) {
    result.providers = config.providers;
  }
  if (config.memory) {
    result.memory = config.memory;
  }
  if (config.mcp_servers) {
    result.mcp_servers = config.mcp_servers;
  }

  return result;
}
