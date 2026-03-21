import type { PermissionMode } from './types.ts';

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'default';

export const DEFAULT_ALLOWED_TOOL_PATTERNS = [
  'read',
  'glob',
  'grep',
  'git-status',
  'git-diff',
  'tool-search',
] as const;

const PERMISSION_MODES = new Set<PermissionMode>(['default', 'acceptEdits', 'plan']);
const EDIT_TOOLS = new Set(['write', 'write_file', 'edit', 'edit_file']);
const PLAN_EXECUTABLE_TOOLS = new Set(['ask-user']);

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && PERMISSION_MODES.has(value as PermissionMode);
}

export function normalizePermissionMode(value: unknown): PermissionMode | undefined {
  return isPermissionMode(value) ? value : undefined;
}

export function isEditTool(toolName: string): boolean {
  return EDIT_TOOLS.has(toolName);
}

export function canExecuteInPlanMode(toolName: string): boolean {
  return PLAN_EXECUTABLE_TOOLS.has(toolName);
}
