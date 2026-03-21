import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { CommandRegistry } from './registry.ts';
import { createCommandEntryFromFile, readMarkdownCommandFile } from './custom/shared.ts';

export async function registerSkillCommands(registry: CommandRegistry, cwd: string): Promise<void> {
  const projectDir = resolve(cwd, '.iris', 'skills');
  const globalDir = resolve(process.env.HOME ?? homedir(), '.iris', 'skills');

  const skillFiles = new Map<string, string>();
  for (const filePath of loadSkillFiles(globalDir)) {
    skillFiles.set(skillNameFromPath(filePath), filePath);
  }
  for (const filePath of loadSkillFiles(projectDir)) {
    skillFiles.set(skillNameFromPath(filePath), filePath);
  }

  for (const [name, filePath] of skillFiles) {
    const parsed = await readMarkdownCommandFile(filePath);
    registry.registerCustom(
      createCommandEntryFromFile(
        name,
        filePath,
        'skill',
        parsed,
        `Skill command from ${name}.skill.md`,
      ),
    );
  }
}

function loadSkillFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.skill.md'))
    .map((entry) => resolve(directory, entry.name));
}

function skillNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop()?.replace(/\.skill\.md$/i, '') ?? filePath;
}
