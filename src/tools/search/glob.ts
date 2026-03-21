import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

export class GlobTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'glob',
    description: 'Find files matching a glob pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.ts")' },
        cwd: { type: 'string', description: 'Directory to search from (default: process.cwd())' },
      },
      required: ['pattern'],
    },
  };

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const pattern = input['pattern'];
    if (typeof pattern !== 'string' || !pattern) {
      return fail('glob', 'pattern must be a non-empty string');
    }
    const cwd = typeof input['cwd'] === 'string' ? input['cwd'] : process.cwd();

    let matches: string[];
    try {
      const g = new Bun.Glob(pattern);
      matches = [...g.scanSync({ cwd, onlyFiles: false })];
    } catch (err) {
      return fail('glob', `glob error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (matches.length === 0) return ok('No files found.');
    return ok(matches.sort().join('\n'));
  }
}
