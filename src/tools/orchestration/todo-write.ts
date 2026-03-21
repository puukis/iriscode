import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

type TodoStatus = 'pending' | 'in-progress' | 'done';

interface TodoItem {
  id: string;
  task: string;
  status: TodoStatus;
  notes?: string;
}

export class TodoWriteTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'todo-write',
    description:
      'Persist a structured todo list to .iriscode/todos.md in the project root for project task tracking. Do not use this for ordinary list-writing in chat.',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Todo objects with id, task, status, and optional notes',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              task: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in-progress', 'done'],
                description: 'Canonical values are pending, in-progress, or done',
              },
              notes: { type: 'string' },
            },
            required: ['id', 'task', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  };

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const todosValue = input['todos'];
    if (!Array.isArray(todosValue)) {
      return fail('todo-write', 'todos must be an array');
    }

    const todos: TodoItem[] = [];
    for (const item of todosValue) {
      const parsed = parseTodo(item);
      if ('error' in parsed) return parsed.error;
      todos.push(parsed.value);
    }

    const iriscodeDir = join(context.cwd, '.iriscode');
    const outputPath = join(iriscodeDir, 'todos.md');
    const content = renderTodosMarkdown(todos);

    try {
      await mkdir(iriscodeDir, { recursive: true });
      await writeFile(outputPath, content, 'utf-8');
    } catch (err) {
      return fail(
        'todo-write',
        `Failed to write "${outputPath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return ok(`Wrote ${todos.length} todos to ${outputPath}`);
  }
}

function parseTodo(value: unknown): { value: TodoItem } | { error: ToolResult } {
  if (!value || typeof value !== 'object') {
    return { error: fail('todo-write', 'each todo must be an object') };
  }

  const item = value as Record<string, unknown>;
  const id = typeof item['id'] === 'string' ? item['id'].trim() : '';
  const task = typeof item['task'] === 'string' ? item['task'].trim() : '';
  const status = normalizeStatus(item['status']);
  const notes = typeof item['notes'] === 'string' ? item['notes'].trim() : undefined;

  if (!id) return { error: fail('todo-write', 'each todo id must be a non-empty string') };
  if (!task) return { error: fail('todo-write', 'each todo task must be a non-empty string') };
  if (!status) {
    return { error: fail('todo-write', 'each todo status must be pending, in-progress, or done') };
  }

  return { value: { id, task, status, notes } };
}

function normalizeStatus(value: unknown): TodoStatus | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (['pending', 'not started', 'not-started', 'todo', 'to-do', 'open'].includes(normalized)) {
    return 'pending';
  }

  if (['in-progress', 'in progress', 'active', 'started', 'doing'].includes(normalized)) {
    return 'in-progress';
  }

  if (['done', 'complete', 'completed', 'finished'].includes(normalized)) {
    return 'done';
  }

  return null;
}

function renderTodosMarkdown(todos: TodoItem[]): string {
  const lines = [
    '# IrisCode Todos',
    '',
    '| ID | Status | Task | Notes |',
    '| --- | --- | --- | --- |',
    ...todos.map((todo) => {
      const notes = todo.notes ? escapeTableCell(todo.notes) : '';
      return `| ${escapeTableCell(todo.id)} | ${todo.status} | ${escapeTableCell(todo.task)} | ${notes} |`;
    }),
    '',
  ];

  return lines.join('\n');
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
