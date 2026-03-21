import type { PermissionMode } from '../permissions/types.ts';

export function buildStartupSummary(
  model: string,
  mode: PermissionMode,
  maxTokens: number,
  contextText: string,
): string {
  const usedTokens = estimateContextTokens(contextText);
  return `model: ${model} | mode: ${formatModeLabel(mode)} | memory: ${usedTokens.toLocaleString()}/${maxTokens.toLocaleString()} tokens`;
}

export function estimateContextTokens(contextText: string): number {
  const trimmed = contextText.trim();
  if (!trimmed) {
    return 0;
  }

  const matches = trimmed.match(/[\p{L}\p{N}]+|[^\s]/gu);
  return matches?.length ?? 0;
}

function formatModeLabel(mode: PermissionMode): string {
  return mode === 'plan' ? 'plan (dry run)' : mode;
}
