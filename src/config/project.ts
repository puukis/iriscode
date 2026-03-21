import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { IrisConfig } from './schema.ts';
import { parseConfigObject } from './schema.ts';

export const PROJECT_STATE_DIR = '.iris';
export const PROJECT_SETTINGS_FILE = 'settings.local.json';
const PROJECT_GITIGNORE_FILE = '.gitignore';

const DEFAULT_PROJECT_SETTINGS = {
  mode: 'default',
  permissions: {
    allow: [],
    deny: [],
  },
};

export function ensureProjectContext(cwd: string): void {
  const stateDir = join(cwd, PROJECT_STATE_DIR);
  mkdirSync(stateDir, { recursive: true });

  const gitignorePath = join(stateDir, PROJECT_GITIGNORE_FILE);
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '*\n', 'utf-8');
  }

  const settingsPath = join(stateDir, PROJECT_SETTINGS_FILE);
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, `${JSON.stringify(DEFAULT_PROJECT_SETTINGS, null, 2)}\n`, 'utf-8');
  }
}

export function loadProjectConfig(cwd: string = process.cwd()): Partial<IrisConfig> {
  ensureProjectContext(cwd);

  const parsed = readProjectSettings(cwd);
  if (!parsed) {
    return {};
  }

  return parseConfigObject(flattenProjectSettings(parsed));
}

export function addProjectAllowedTool(cwd: string, pattern: string): void {
  updateProjectToolList(cwd, 'allow', pattern);
}

export function addProjectBlockedTool(cwd: string, pattern: string): void {
  updateProjectToolList(cwd, 'deny', pattern);
}

function updateProjectToolList(
  cwd: string,
  key: 'allow' | 'deny',
  pattern: string,
): void {
  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) {
    return;
  }

  ensureProjectContext(cwd);
  const parsed = normalizeProjectSettings(readProjectSettings(cwd) ?? structuredClone(DEFAULT_PROJECT_SETTINGS));
  const permissions = getProjectPermissionsContainer(parsed);
  const nextValues = Array.isArray(permissions[key])
    ? permissions[key]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  if (!nextValues.includes(trimmedPattern)) {
    nextValues.push(trimmedPattern);
  }

  permissions[key] = nextValues;
  writeProjectSettings(cwd, parsed);
}

function readProjectSettings(cwd: string): Record<string, unknown> | null {
  const settingsPath = join(cwd, PROJECT_STATE_DIR, PROJECT_SETTINGS_FILE);
  let content = '';
  try {
    content = readFileSync(settingsPath, 'utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

function writeProjectSettings(cwd: string, value: Record<string, unknown>): void {
  const settingsPath = join(cwd, PROJECT_STATE_DIR, PROJECT_SETTINGS_FILE);
  writeFileSync(settingsPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function flattenProjectSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeProjectSettings(settings);
  const permissions = getProjectPermissionsContainer(normalized);

  return {
    ...normalized,
    allowed_tools: toStringArray(permissions.allow),
    disallowed_tools: toStringArray(permissions.deny),
  };
}

function normalizeProjectSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    ...settings,
  };
  const permissions = getProjectPermissionsContainer(normalized);

  const legacyAllowed = toStringArray(normalized.allowed_tools);
  const legacyDenied = toStringArray(normalized.disallowed_tools);
  const allow = toStringArray(permissions.allow);
  const deny = toStringArray(permissions.deny);

  permissions.allow = mergeUniqueStrings(allow, legacyAllowed);
  permissions.deny = mergeUniqueStrings(deny, legacyDenied);

  delete normalized.allowed_tools;
  delete normalized.disallowed_tools;

  return normalized;
}

function getProjectPermissionsContainer(settings: Record<string, unknown>): Record<string, unknown> {
  if (typeof settings.permissions !== 'object' || settings.permissions === null) {
    settings.permissions = {
      allow: [],
      deny: [],
    };
  }

  return settings.permissions as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeUniqueStrings(primary: string[], fallback: string[]): string[] {
  return [...primary, ...fallback.filter((entry) => !primary.includes(entry))];
}
