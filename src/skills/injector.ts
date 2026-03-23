import type { Session } from '../agent/session.ts';
import type { PermissionEngine } from '../permissions/engine.ts';
import type { Skill, SkillContextModifier, SkillInjection } from './types.ts';

export function injectSkill(
  skill: Skill,
  session: Session,
  permissionEngine: PermissionEngine,
): SkillInjection {
  const visibleMessage = {
    role: 'user' as const,
    content: `<command-message>The "${skill.frontmatter.name}" skill is loading</command-message>\n<command-name>${skill.frontmatter.name}</command-name>`,
    commandName: skill.frontmatter.name,
  };
  const hiddenMessage = {
    role: 'user' as const,
    content: `${skill.instructions}\n\nNote: All paths to scripts and references are relative to ${skill.baseDir}`,
    isMeta: true,
  };
  const contextModifier: SkillContextModifier = {
    preApprovedTools: parseAllowedTools(skill.frontmatter.allowed_tools),
    modelOverride: skill.frontmatter.model?.trim() || null,
  };

  session.addMessage(visibleMessage);
  session.addMessage(hiddenMessage);

  for (const pattern of contextModifier.preApprovedTools) {
    permissionEngine.addAllowed(pattern, 'skill');
  }

  return {
    visibleMessage,
    hiddenMessage,
    contextModifier,
  };
}

export function clearSkillContext(
  _session: Session,
  permissionEngine: PermissionEngine,
): void {
  permissionEngine.clearTier('skill');
}

function parseAllowedTools(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
