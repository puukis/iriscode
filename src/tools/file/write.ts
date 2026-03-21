import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';
import type { DiffInterceptor } from '../../diff/interceptor.ts';
import { resolveProjectFilePath } from './path.ts';

export class WriteFileTool implements Tool {
  constructor(private readonly interceptor?: DiffInterceptor) {}

  readonly definition: ToolDefinitionSchema = {
    name: 'write',
    description:
      'Write content to a file, creating parent directories if needed. For assistant-managed project state, notes, or saved preferences, prefer descriptive paths under .iris/ instead of inventing dotfiles in the project root.',
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
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const path = input['path'];
    const content = input['content'];

    if (typeof path !== 'string' || !path) {
      return fail('write', 'path must be a non-empty string');
    }
    if (typeof content !== 'string') {
      return fail('write', 'content must be a string');
    }

    const filePath = resolveProjectFilePath(context.cwd, path);

    try {
      const decision = this.interceptor
        ? await this.interceptor.intercept(filePath, content)
        : 'accepted';

      if (decision === 'rejected') {
        return ok('File write rejected by user. The file was not modified.');
      }

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
    } catch (err) {
      return fail(
        'write',
        `Failed to write "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return ok(`Written ${content.length} characters to ${filePath}`);
  }
}
