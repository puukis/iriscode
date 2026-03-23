import type { PermissionMode } from '../permissions/types.ts';
import type { McpServerState } from '../mcp/types.ts';
import type { HookRegistry } from '../hooks/registry.ts';
import type { PluginLoadResult } from '../plugins/types.ts';
import type { SkillLoadResult } from '../skills/types.ts';

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

export function buildMcpStartupSummary(states: McpServerState[]): string | null {
  const connected = states.filter((state) => state.status === 'connected');
  if (connected.length === 0) {
    return null;
  }

  return `MCP: ${connected
    .map((state) => `${state.config.name} (${state.tools.length} tools)`)
      .join(', ')}`;
}

export function buildExtensibilityStartupSummary(
  skillResult: SkillLoadResult,
  pluginResult: PluginLoadResult,
  hookRegistry: HookRegistry,
  connectedMcpServerCount: number,
): string {
  const pluginCount = pluginResult.plugins.length;
  const commandCount = pluginResult.plugins.reduce((sum, plugin) => sum + plugin.components.commands.length, 0);
  const pluginSkillCount = pluginResult.plugins.reduce((sum, plugin) => sum + plugin.components.skills.length, 0);
  const hookCount = hookRegistry.list().length;

  return `Skills: ${skillResult.skills.length} | Plugins: ${pluginCount} (${commandCount} commands, ${pluginSkillCount} skills, ${hookCount} hooks) | MCP: ${connectedMcpServerCount} server${connectedMcpServerCount === 1 ? '' : 's'}`;
}
