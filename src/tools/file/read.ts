import { readFile } from 'fs/promises';
import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

export class ReadFileTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'read',
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

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const path = input['path'];
    if (typeof path !== 'string' || !path) {
      return fail('read', 'path must be a non-empty string');
    }

    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch (err) {
      return fail(
        'read',
        `Failed to read "${path}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const startLine = input['start_line'];
    const endLine = input['end_line'];

    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const start = typeof startLine === 'number' ? Math.max(1, startLine) - 1 : 0;
      const end = typeof endLine === 'number' ? Math.min(endLine, lines.length) : lines.length;
      return ok(lines.slice(start, end).join('\n'));
    }

    return ok(content);
  }
}
