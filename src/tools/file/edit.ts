import { readFile, writeFile } from 'fs/promises';
import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

export class EditFileTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'edit',
    description:
      'Replace an exact string in a file. The old_string must match exactly once in the file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to edit' },
        old_string: { type: 'string', description: 'Exact string to replace' },
        new_string: { type: 'string', description: 'Replacement string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  };

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const path = input['path'];
    const oldString = input['old_string'];
    const newString = input['new_string'];

    if (typeof path !== 'string' || !path) {
      return fail('edit', 'path must be a non-empty string');
    }
    if (typeof oldString !== 'string') {
      return fail('edit', 'old_string must be a string');
    }
    if (typeof newString !== 'string') {
      return fail('edit', 'new_string must be a string');
    }

    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch (err) {
      return fail(
        'edit',
        `Failed to read "${path}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const occurrences = countOccurrences(content, oldString);
    if (occurrences === 0) {
      return fail('edit', `old_string not found in "${path}"`);
    }
    if (occurrences > 1) {
      return fail('edit', `old_string matches ${occurrences} times in "${path}" — must match exactly once`);
    }

    const newContent = content.replace(oldString, newString);

    try {
      await writeFile(path, newContent, 'utf-8');
    } catch (err) {
      return fail(
        'edit',
        `Failed to write "${path}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return ok(`Replaced 1 occurrence in ${path}`);
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}
