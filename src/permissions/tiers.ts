import { loadProjectConfig } from '../config/project.ts';
import { loadUserConfig } from '../config/user.ts';
import { DEFAULT_ALLOWED_TOOL_PATTERNS } from './modes.ts';
import type { PermissionRule, PermissionTier } from './types.ts';

export function resolveRules(cwd: string): PermissionRule[] {
  const rules: PermissionRule[] = [];

  appendRules(rules, loadProjectConfig(cwd), 'project');
  appendRules(rules, loadUserConfig(), 'user');
  appendRules(
    rules,
    { allowed_tools: [...DEFAULT_ALLOWED_TOOL_PATTERNS] },
    'global',
  );

  return rules;
}

function appendRules(
  target: PermissionRule[],
  config: { allowed_tools?: string[]; disallowed_tools?: string[] },
  tier: PermissionTier,
): void {
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
  if (tier === 'project') {
    return decision === 'allow'
      ? 'Allowed by project configuration in .iris/settings.local.json'
      : 'Denied by project configuration in .iris/settings.local.json';
  }

  if (tier === 'user') {
    return decision === 'allow'
      ? 'Allowed by user configuration in ~/.iris/config.toml'
      : 'Denied by user configuration in ~/.iris/config.toml';
  }

  return 'Allowed by built-in global defaults';
}
