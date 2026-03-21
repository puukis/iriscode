import { readFile } from 'fs/promises';
import { Tool } from '../index.ts';
import type { ToolDefinitionSchema } from '../../shared/types.ts';
import { ToolError } from '../../shared/errors.ts';

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

  async execute(input: Record<string, unknown>): Promise<string> {
    const pattern = input['pattern'];
    const pathOrGlob = input['path'];

    if (typeof pattern !== 'string' || !pattern) {
      throw new ToolError('pattern must be a non-empty string', 'grep');
    }
    if (typeof pathOrGlob !== 'string' || !pathOrGlob) {
      throw new ToolError('path must be a non-empty string', 'grep');
    }

    const flags = input['case_insensitive'] === true ? 'i' : '';
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      throw new ToolError(`Invalid regex: ${pattern}`, 'grep');
    }

    const g = new Bun.Glob(pathOrGlob);
    const files = [...g.scanSync({ cwd: process.cwd(), onlyFiles: true })];
    if (files.length === 0) {
      return 'No files matched the path pattern.';
    }

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

    if (results.length === 0) return 'No matches found.';
    return results.join('\n');
  }
}
