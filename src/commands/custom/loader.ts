import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { ensureDirectory } from '../../config/utils.ts';
import type { CommandEntry } from '../types.ts';
import { createCommandEntryFromFile, readMarkdownCommandFile } from './shared.ts';

export async function loadCustomCommands(cwd: string): Promise<CommandEntry[]> {
  const projectDir = ensureDirectory(resolve(cwd, '.iris', 'commands'));
  const globalDir = ensureDirectory(join(process.env.HOME ?? homedir(), '.iris', 'commands'));

  const globalCommands = await loadCommandsFromDirectory(globalDir, 'custom');
  const projectCommands = await loadCommandsFromDirectory(projectDir, 'custom');
  const byName = new Map<string, CommandEntry>();

  for (const entry of globalCommands) {
    byName.set(entry.name, entry);
  }
  for (const entry of projectCommands) {
    byName.set(entry.name, entry);
  }

  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}

async function loadCommandsFromDirectory(
  directory: string,
  category: CommandEntry['category'],
): Promise<CommandEntry[]> {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = readdirSync(directory, { withFileTypes: true });
  const commands: CommandEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.endsWith('.skill.md')) {
      continue;
    }

    const filePath = resolve(directory, entry.name);
    const parsed = await readMarkdownCommandFile(filePath);
    const name = entry.name.replace(/\.md$/i, '');
    commands.push(
      createCommandEntryFromFile(
        name,
        filePath,
        category,
        parsed,
        `Custom command from ${entry.name}`,
      ),
    );
  }

  return commands;
}
