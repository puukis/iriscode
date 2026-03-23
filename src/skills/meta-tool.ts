import type { Session } from '../agent/session.ts';
import type { PermissionEngine } from '../permissions/engine.ts';
import type { Tool, ToolDefinitionSchema, ToolResult } from '../tools/index.ts';
import { fail } from '../tools/result.ts';
import { getSkill } from './loader.ts';
import { injectSkill } from './injector.ts';
import type { Skill, SkillContextModifier } from './types.ts';

export function buildSkillToolDefinition(skills: Skill[]): ToolDefinitionSchema {
  return {
    name: 'Skill',
    description: `Execute a skill within the main conversation

<skills_instructions>
When the user asks you to perform a task, check if any of the available
skills below can help complete the task more effectively. If a relevant
skill exists, invoke it using the Skill tool before proceeding.
</skills_instructions>

<available_skills>
${skills.map((skill) => `"${skill.frontmatter.name}": ${skill.frontmatter.description}`).join('\n')}
</available_skills>`,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The skill name to invoke' },
      },
      required: ['command'],
    },
    risk: 'low',
  };
}

export function buildSkillTool(
  skills: Skill[],
  session: Session,
  permissionEngine: PermissionEngine,
): Tool {
  return {
    definition: buildSkillToolDefinition(skills),
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const command = typeof input.command === 'string' ? input.command.trim() : '';
      if (!command) {
        return fail('Skill', 'command must be a non-empty string');
      }

      const skill = getSkill(command, {
        skills,
        availableSkills: skills,
        errors: [],
        characterBudgetUsed: 0,
      });
      if (!skill) {
        return {
          content: `Unknown skill: ${command}. Available skills: ${skills.map((entry) => entry.frontmatter.name).join(', ')}`,
          isError: true,
        };
      }

      const injection = injectSkill(skill, session, permissionEngine);
      return {
        content: `Loaded skill "${skill.frontmatter.name}"`,
        contextModifier: injection.contextModifier as SkillContextModifier,
      } as ToolResult & { contextModifier: SkillContextModifier };
    },
  };
}
