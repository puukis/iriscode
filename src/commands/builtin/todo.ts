import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { BuiltinHandler, CommandEntry } from '../types.ts';

export const TODO_COMMAND: CommandEntry = {
  name: 'todo',
  description: 'Show the current project todo list from .iris/todos.md.',
  category: 'builtin',
};

export const handleTodo: BuiltinHandler = async (ctx) => {
  try {
    const todoPath = join(ctx.cwd, '.iris', 'todos.md');
    if (!existsSync(todoPath)) {
      ctx.session.writeInfo('No todos yet. The agent will create .iris/todos.md when it uses the todo-write tool.');
      return { type: 'handled' };
    }

    ctx.session.writeInfo(readFileSync(todoPath, 'utf-8'));
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};
