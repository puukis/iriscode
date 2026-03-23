import { loadGlobalConfigSync } from '../config/global.ts';
import { loadProjectConfigSync } from '../config/project.ts';
import { DEFAULT_ALLOWED_TOOL_PATTERNS } from './modes.ts';
import type { PermissionRule, PermissionTier } from './types.ts';

export function resolveRules(cwd: string): PermissionRule[] {
  const rules: PermissionRule[] = [];

  appendRules(rules, loadProjectConfigSync(cwd).config.permissions, 'project');
  appendRules(rules, loadGlobalConfigSync().config.permissions, 'user');
  appendRules(
    rules,
    { allowed_tools: [...DEFAULT_ALLOWED_TOOL_PATTERNS] },
    'global',
  );

  return rules;
}

function appendRules(
  target: PermissionRule[],
  config: { allowed_tools?: string[]; disallowed_tools?: string[] } | undefined,
  tier: PermissionTier,
): void {
  if (!config) {
    return;
  }

  for (const pattern of config.disallowed_tools ?? []) {
    target.push({
      pattern,
      decision: 'deny',
      tier,
      reason: describeTierReason(tier, 'deny'),
    });
  }

  for (const pattern of config.allowed_tools ?? []) {
    target.push({
      pattern,
      decision: 'allow',
      tier,
      reason: describeTierReason(tier, 'allow'),
    });
  }
}

function describeTierReason(tier: PermissionTier, decision: 'allow' | 'deny'): string {
  if (tier === 'skill') {
    return decision === 'allow'
      ? 'Allowed temporarily by the active skill for this agent turn'
      : 'Denied temporarily by the active skill for this agent turn';
  }

  if (tier === 'project') {
    return decision === 'allow'
      ? 'Allowed by project configuration in IRIS.md or .iris/settings.local.json'
      : 'Denied by project configuration in IRIS.md or .iris/settings.local.json';
  }

  if (tier === 'user') {
    return decision === 'allow'
      ? 'Allowed by user configuration in ~/.iris/config.toml'
      : 'Denied by user configuration in ~/.iris/config.toml';
  }

  return 'Allowed by built-in global defaults';
}
