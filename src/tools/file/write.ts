import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { Tool } from '../index.ts';
import type { ToolDefinitionSchema } from '../../shared/types.ts';
import { ToolError } from '../../shared/errors.ts';

export class WriteFileTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'write_file',
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

  async execute(input: Record<string, unknown>): Promise<string> {
    const path = input['path'];
    const content = input['content'];

    if (typeof path !== 'string' || !path) {
      throw new ToolError('path must be a non-empty string', 'write_file');
    }
    if (typeof content !== 'string') {
      throw new ToolError('content must be a string', 'write_file');
    }

    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf-8');
    } catch (err) {
      throw new ToolError(
        `Failed to write "${path}": ${err instanceof Error ? err.message : String(err)}`,
        'write_file',
      );
    }

    return `Written ${content.length} characters to ${path}`;
  }
}
