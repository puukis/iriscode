import { Tool } from '../index.ts';
import type { ToolDefinitionSchema } from '../../shared/types.ts';
import { ToolError } from '../../shared/errors.ts';

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

  async execute(input: Record<string, unknown>): Promise<string> {
    const pattern = input['pattern'];
    if (typeof pattern !== 'string' || !pattern) {
      throw new ToolError('pattern must be a non-empty string', 'glob');
    }
    const cwd = typeof input['cwd'] === 'string' ? input['cwd'] : process.cwd();

    let matches: string[];
    try {
      const g = new Bun.Glob(pattern);
      matches = [...g.scanSync({ cwd, onlyFiles: false })];
    } catch (err) {
      throw new ToolError(
        `glob error: ${err instanceof Error ? err.message : String(err)}`,
        'glob',
      );
    }

    if (matches.length === 0) return 'No files found.';
    return matches.sort().join('\n');
  }
}
