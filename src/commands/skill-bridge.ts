import type { Session } from '../agent/session.ts';
import { getSkill } from '../skills/loader.ts';
import { injectSkill } from '../skills/injector.ts';
import type { Skill, SkillLoadResult } from '../skills/types.ts';
import type { CommandContext, CommandEntry, CommandResult } from './types.ts';
import { CommandRegistry } from './registry.ts';

export function registerSkillCommands(
  registry: CommandRegistry,
  skillResult: SkillLoadResult,
): void {
  clearSkillCommands(registry);

  for (const skill of skillResult.skills) {
    registry.registerCustom(createSkillCommandEntry(skill));
  }
}

export function loadSkillIntoSession(
  name: string,
  ctx: Pick<CommandContext, 'session' | 'engine' | 'skillResult'>,
): { skill: Skill } | { error: string } {
  if (!ctx.skillResult) {
    return { error: 'Skills are unavailable in this session.' };
  }

  const skill = findSkillByCommandName(name, ctx.skillResult);
  if (!skill) {
    return {
      error: `Unknown skill: ${name}. Available skills: ${ctx.skillResult.skills.map((entry) => entry.frontmatter.name).join(', ')}`,
    };
  }

  if (typeof ctx.session.addMessage !== 'function') {
    return { error: 'Skill commands require a live session.' };
  }

  const injection = injectSkill(skill, ctx.session as Session, ctx.engine);
  ctx.session.setNextPromptModelOverride?.(injection.contextModifier.modelOverride);

  return { skill };
}

export function runSkillCommand(
  name: string,
  args: string[],
  ctx: Pick<CommandContext, 'session' | 'engine' | 'skillResult'>,
): CommandResult {
  const loaded = loadSkillIntoSession(name, ctx);
  if ('error' in loaded) {
    return { type: 'error', message: loaded.error };
  }

  const prompt = args.join(' ').trim();
  if (!prompt) {
    ctx.session.writeInfo(`Loaded skill: ${loaded.skill.frontmatter.name}`);
    return { type: 'handled' };
  }

  return { type: 'prompt', text: prompt };
}

function createSkillCommandEntry(skill: Skill): CommandEntry {
  return {
    name: skill.frontmatter.name,
    description: skill.frontmatter.description,
    category: 'skill',
    argumentHint: '[prompt]',
    source: skill.source,
    allowedTools: parseAllowedTools(skill.frontmatter.allowed_tools),
    model: skill.frontmatter.model?.trim() || undefined,
  };
}

function clearSkillCommands(registry: CommandRegistry): void {
  for (const entry of registry.list()) {
    if (entry.category === 'skill') {
      registry.unregister(entry.name);
    }
  }
}

function findSkillByCommandName(name: string, result: SkillLoadResult): Skill | undefined {
  return getSkill(name, result)
    ?? result.skills.find((skill) => skill.frontmatter.name.toLowerCase() === name.toLowerCase());
}

function parseAllowedTools(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const tools = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return tools.length > 0 ? tools : undefined;
}
