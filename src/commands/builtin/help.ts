import type { BuiltinHandler, CommandEntry } from '../types.ts';
import type { CommandRegistry } from '../registry.ts';

export const HELP_COMMAND: CommandEntry = {
  name: 'help',
  description: 'Show all slash commands or details for a specific command.',
  category: 'builtin',
  argumentHint: '[command]',
};

export function createHelpHandler(registry: CommandRegistry): BuiltinHandler {
  return async (ctx) => {
    try {
      const commandName = ctx.args[0]?.replace(/^\//, '').trim().toLowerCase();
      if (!commandName) {
        ctx.session.writeInfo(renderCommandTable(registry.list()));
        return { type: 'handled' };
      }

      const command = registry.get(commandName);
      if (!command) {
        return { type: 'error', message: `Unknown command "/${commandName}".` };
      }

      ctx.session.writeInfo(renderCommandDetail(command.entry));
      return { type: 'handled' };
    } catch (error) {
      return { type: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  };
}

function renderCommandTable(entries: CommandEntry[]): string {
  const groups: Record<CommandEntry['category'], CommandEntry[]> = {
    builtin: [],
    custom: [],
    skill: [],
  };

  for (const entry of entries) {
    groups[entry.category].push(entry);
  }

  const lines: string[] = ['Slash commands', ''];
  for (const category of ['builtin', 'custom', 'skill'] as const) {
    if (groups[category].length === 0) {
      continue;
    }
    lines.push(`${category}:`);
    for (const entry of groups[category]) {
      lines.push(`  /${entry.name.padEnd(16)} ${entry.description}`);
    }
    lines.push('');
  }
  lines.push('Project custom commands in .iris/commands/ are gitignored by default.');
  return lines.join('\n').trimEnd();
}

function renderCommandDetail(entry: CommandEntry): string {
  const lines = [
    `/${entry.name}`,
    '',
    entry.description,
    entry.argumentHint ? `Arguments: ${entry.argumentHint}` : null,
    entry.allowedTools?.length ? `Allowed tools: ${entry.allowedTools.join(', ')}` : null,
    entry.model ? `Model: ${entry.model}` : null,
    entry.source ? `Source: ${entry.source}` : null,
    `Usage: /${entry.name}${entry.argumentHint ? ` ${entry.argumentHint}` : ''}`,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}
