import { readFile, writeFile } from 'fs/promises';
import { Tool } from '../index.ts';
import type { ToolDefinitionSchema } from '../../shared/types.ts';
import { ToolError } from '../../shared/errors.ts';

export class EditFileTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'edit_file',
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

  async execute(input: Record<string, unknown>): Promise<string> {
    const path = input['path'];
    const oldString = input['old_string'];
    const newString = input['new_string'];

    if (typeof path !== 'string' || !path) {
      throw new ToolError('path must be a non-empty string', 'edit_file');
    }
    if (typeof oldString !== 'string') {
      throw new ToolError('old_string must be a string', 'edit_file');
    }
    if (typeof newString !== 'string') {
      throw new ToolError('new_string must be a string', 'edit_file');
    }

    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch (err) {
      throw new ToolError(
        `Failed to read "${path}": ${err instanceof Error ? err.message : String(err)}`,
        'edit_file',
      );
    }

    const occurrences = countOccurrences(content, oldString);
    if (occurrences === 0) {
      throw new ToolError(
        `old_string not found in "${path}"`,
        'edit_file',
      );
    }
    if (occurrences > 1) {
      throw new ToolError(
        `old_string matches ${occurrences} times in "${path}" — must match exactly once`,
        'edit_file',
      );
    }

    const newContent = content.replace(oldString, newString);

    try {
      await writeFile(path, newContent, 'utf-8');
    } catch (err) {
      throw new ToolError(
        `Failed to write "${path}": ${err instanceof Error ? err.message : String(err)}`,
        'edit_file',
      );
    }

    return `Replaced 1 occurrence in ${path}`;
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
