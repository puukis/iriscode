import { readFile } from 'fs/promises';
import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

export class GrepTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'grep',
    description: 'Search file contents by regex pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for' },
        path: {
          type: 'string',
          description: 'File path or glob pattern to search in (e.g. "src/**/*.ts")',
        },
        case_insensitive: { type: 'boolean', description: 'Case-insensitive match (default false)' },
      },
      required: ['pattern', 'path'],
    },
  };

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const pattern = input['pattern'];
    const pathOrGlob = input['path'];

    if (typeof pattern !== 'string' || !pattern) {
      return fail('grep', 'pattern must be a non-empty string');
    }
    if (typeof pathOrGlob !== 'string' || !pathOrGlob) {
      return fail('grep', 'path must be a non-empty string');
    }

    const flags = input['case_insensitive'] === true ? 'i' : '';
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      return fail('grep', `Invalid regex: ${pattern}`);
    }

    const g = new Bun.Glob(pathOrGlob);
    const files = [...g.scanSync({ cwd: process.cwd(), onlyFiles: true })];
    if (files.length === 0) return ok('No files matched the path pattern.');

    const results: string[] = [];
    for (const file of files.sort()) {
      let content: string;
      try {
        content = await readFile(file, 'utf-8');
      } catch {
        continue; // skip unreadable files
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          results.push(`${file}:${i + 1}: ${lines[i]}`);
        }
      }
    }

    if (results.length === 0) return ok('No matches found.');
    return ok(results.join('\n'));
  }
}
