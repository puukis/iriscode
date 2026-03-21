import {
  CLEAR_COMMAND,
  handleClear,
} from './builtin/clear.ts';
import {
  COMPACT_COMMAND,
  handleCompact,
} from './builtin/compact.ts';
import {
  COST_COMMAND,
  handleCost,
} from './builtin/cost.ts';
import {
  DOCTOR_COMMAND,
  handleDoctor,
} from './builtin/doctor.ts';
import {
  HELP_COMMAND,
  createHelpHandler,
} from './builtin/help.ts';
import {
  INIT_COMMAND,
  handleInit,
} from './builtin/init.ts';
import {
  MCP_COMMAND,
  handleMcp,
} from './builtin/mcp.ts';
import {
  MEMORY_COMMAND,
  handleMemory,
} from './builtin/memory.ts';
import {
  MODE_COMMAND,
  handleMode,
} from './builtin/mode.ts';
import {
  MODELS_COMMAND,
  handleModels,
} from './builtin/models.ts';
import {
  SESSIONS_COMMAND,
  handleSessions,
} from './builtin/sessions.ts';
import {
  STATUS_COMMAND,
  handleStatus,
} from './builtin/status.ts';
import {
  TODO_COMMAND,
  handleTodo,
} from './builtin/todo.ts';
import {
  TOOLS_COMMAND,
  handleTools,
} from './builtin/tools.ts';
import type { BuiltinHandler, CommandContext, CommandEntry } from './types.ts';

interface RegisteredCommand {
  entry: CommandEntry;
  handler?: BuiltinHandler;
}

const CATEGORY_PRIORITY: Record<CommandEntry['category'], number> = {
  builtin: 0,
  custom: 1,
  skill: 2,
};

export class CommandRegistry {
  private commands = new Map<string, RegisteredCommand>();

  register(entry: CommandEntry, handler: BuiltinHandler): void {
    this.commands.set(normalizeName(entry.name), {
      entry: { ...entry, name: normalizeName(entry.name), category: 'builtin' },
      handler,
    });
  }

  registerCustom(entry: CommandEntry): void {
    this.commands.set(normalizeName(entry.name), {
      entry: { ...entry, name: normalizeName(entry.name) },
    });
  }

  get(name: string): RegisteredCommand | undefined {
    return this.commands.get(normalizeName(name));
  }

  search(query: string): CommandEntry[] {
    const normalizedQuery = normalizeName(query);
    const entries = this.list();
    if (!normalizedQuery) {
      return entries.slice(0, 8);
    }

    return entries
      .map((entry) => ({ entry, score: scoreCommandEntry(entry, normalizedQuery) }))
      .filter((item) => item.score < Number.POSITIVE_INFINITY)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return left.score - right.score;
        }
        if (CATEGORY_PRIORITY[left.entry.category] !== CATEGORY_PRIORITY[right.entry.category]) {
          return CATEGORY_PRIORITY[left.entry.category] - CATEGORY_PRIORITY[right.entry.category];
        }
        return left.entry.name.localeCompare(right.entry.name);
      })
      .slice(0, 8)
      .map((item) => item.entry);
  }

  list(): CommandEntry[] {
    return Array.from(this.commands.values())
      .map((command) => command.entry)
      .sort((left, right) => {
        if (CATEGORY_PRIORITY[left.category] !== CATEGORY_PRIORITY[right.category]) {
          return CATEGORY_PRIORITY[left.category] - CATEGORY_PRIORITY[right.category];
        }
        return left.name.localeCompare(right.name);
      });
  }
}

export function createDefaultRegistry(_ctx: CommandContext): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(CLEAR_COMMAND, handleClear);
  registry.register(COMPACT_COMMAND, handleCompact);
  registry.register(COST_COMMAND, handleCost);
  registry.register(DOCTOR_COMMAND, handleDoctor);
  registry.register(HELP_COMMAND, createHelpHandler(registry));
  registry.register(INIT_COMMAND, handleInit);
  registry.register(MCP_COMMAND, handleMcp);
  registry.register(MEMORY_COMMAND, handleMemory);
  registry.register(MODE_COMMAND, handleMode);
  registry.register(MODELS_COMMAND, handleModels);
  registry.register(SESSIONS_COMMAND, handleSessions);
  registry.register(STATUS_COMMAND, handleStatus);
  registry.register(TODO_COMMAND, handleTodo);
  registry.register(TOOLS_COMMAND, handleTools);
  return registry;
}

function normalizeName(name: string): string {
  return name.trim().replace(/^\/+/, '').toLowerCase();
}

function scoreCommandEntry(entry: CommandEntry, query: string): number {
  const name = normalizeName(entry.name);
  const description = entry.description.toLowerCase();
  const combined = `${name} ${description}`;

  if (name === query) {
    return 0;
  }
  if (name.startsWith(query)) {
    return 10 + (name.length - query.length);
  }
  if (description.startsWith(query)) {
    return 20 + description.length;
  }
  if (name.includes(query)) {
    return 30 + name.indexOf(query);
  }
  if (description.includes(query)) {
    return 40 + description.indexOf(query);
  }

  const distance = levenshteinDistance(query, name);
  if (distance <= Math.max(2, Math.floor(query.length / 2))) {
    return 100 + distance;
  }

  const combinedDistance = levenshteinDistance(query, combined);
  if (combinedDistance <= Math.max(3, Math.floor(query.length / 2) + 1)) {
    return 120 + combinedDistance;
  }

  return Number.POSITIVE_INFINITY;
}

function levenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row++) {
    table[row][0] = row;
  }
  for (let col = 0; col < cols; col++) {
    table[0][col] = col;
  }

  for (let row = 1; row < rows; row++) {
    for (let col = 1; col < cols; col++) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      table[row][col] = Math.min(
        table[row - 1][col] + 1,
        table[row][col - 1] + 1,
        table[row - 1][col - 1] + cost,
      );
    }
  }

  return table[rows - 1][cols - 1];
}
