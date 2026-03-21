import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

export class WriteFileTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'write',
    description: 'Write content to a file, creating parent directories if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  };

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const path = input['path'];
    const content = input['content'];

    if (typeof path !== 'string' || !path) {
      return fail('write', 'path must be a non-empty string');
    }
    if (typeof content !== 'string') {
      return fail('write', 'content must be a string');
    }

    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf-8');
    } catch (err) {
      return fail(
        'write',
        `Failed to write "${path}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return ok(`Written ${content.length} characters to ${path}`);
  }
}
