import { access, readFile } from 'fs/promises';
import { basename, join } from 'path';
import { homedir } from 'os';
import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

export class SkillTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'skill',
    description: 'Load a named .skill.md file from the project or global IrisCode skills directory.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name or filename' },
      },
      required: ['name'],
    },
  };

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const rawName = typeof input['name'] === 'string' ? input['name'].trim() : '';
    if (!rawName) {
      return fail('skill', 'name must be a non-empty string');
    }

    const fileName = rawName.endsWith('.skill.md') ? rawName : `${rawName}.skill.md`;
    if (basename(fileName) !== fileName) {
      return fail('skill', 'name must be a plain filename without path separators');
    }

    const candidates = [
      join(context.cwd, '.iriscode', 'skills', fileName),
      join(homedir(), '.config', 'iriscode', 'skills', fileName),
    ];

    for (const path of candidates) {
      try {
        await access(path);
        const instructions = await readFile(path, 'utf-8');
        const skillName = fileName.replace(/\.skill\.md$/i, '');
        const existingIndex = context.loadedSkills.findIndex((skill) => skill.path === path);

        if (existingIndex >= 0) {
          context.loadedSkills[existingIndex] = { name: skillName, path, instructions };
        } else {
          context.loadedSkills.push({ name: skillName, path, instructions });
        }

        return ok(`Loaded skill "${skillName}" from ${path}`);
      } catch {
        // try the next location
      }
    }

    return fail(
      'skill',
      `Skill "${fileName}" was not found in .iriscode/skills or ~/.config/iriscode/skills`,
    );
  }
}
