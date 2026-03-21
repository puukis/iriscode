import { readFile } from 'fs/promises';
import { Tool } from '../index.ts';
import type { ToolDefinitionSchema } from '../../shared/types.ts';
import { ToolError } from '../../shared/errors.ts';

export class ReadFileTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'read_file',
    description: 'Read the contents of a file. Optionally read only a range of lines.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file' },
        start_line: { type: 'number', description: 'First line to read (1-indexed, inclusive)' },
        end_line: { type: 'number', description: 'Last line to read (1-indexed, inclusive)' },
      },
      required: ['path'],
    },
  };

  async execute(input: Record<string, unknown>): Promise<string> {
    const path = input['path'];
    if (typeof path !== 'string' || !path) {
      throw new ToolError('path must be a non-empty string', 'read_file');
    }

    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch (err) {
      throw new ToolError(
        `Failed to read "${path}": ${err instanceof Error ? err.message : String(err)}`,
        'read_file',
      );
    }

    const startLine = input['start_line'];
    const endLine = input['end_line'];

    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const start = typeof startLine === 'number' ? Math.max(1, startLine) - 1 : 0;
      const end = typeof endLine === 'number' ? Math.min(endLine, lines.length) : lines.length;
      return lines.slice(start, end).join('\n');
    }

    return content;
  }
}
