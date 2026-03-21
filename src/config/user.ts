import {
  getGlobalConfigPath,
  loadGlobalConfigSync,
  writeGlobalConfig,
} from './global.ts';
import type { GlobalConfig } from './schema.ts';

export function ensureUserConfigDir(): string {
  return getGlobalConfigPath().replace(/\/config\.toml$/, '');
}

export function getUserConfigPath(): string {
  return getGlobalConfigPath();
}

export function loadUserConfig(): Partial<GlobalConfig> {
  return loadGlobalConfigSync().config;
}

export function writeUserConfig(config: Partial<GlobalConfig>): void {
  writeGlobalConfig(config);
}
