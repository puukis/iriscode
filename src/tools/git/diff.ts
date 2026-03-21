import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';
import { isGitRepo, runGit } from './utils.ts';

const MAX_DIFF_CHARS = 50_000;

export class GitDiffTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'git-diff',
    description: 'Show the raw git diff for unstaged changes or staged changes.',
    inputSchema: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: 'When true, show git diff --staged' },
        file: { type: 'string', description: 'Optional file path to diff' },
      },
    },
  };

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    if (!(await isGitRepo(context.cwd))) {
      return fail('git-diff', 'Current directory is not a git repository');
    }

    const staged = input['staged'] === true;
    const file = input['file'];
    if (file !== undefined && (typeof file !== 'string' || !file.trim())) {
      return fail('git-diff', 'file must be a non-empty string when provided');
    }

    const args = ['diff'];
    if (staged) args.push('--staged');
    if (typeof file === 'string' && file.trim()) {
      args.push('--', file.trim());
    }

    const result = await runGit(args, context.cwd);
    if (result.exitCode !== 0) {
      return fail('git-diff', result.stderr.trim() || 'git diff failed');
    }

    if (!result.stdout) {
      return ok('(no diff)');
    }

    const truncated =
      result.stdout.length > MAX_DIFF_CHARS
        ? `${result.stdout.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated to ${MAX_DIFF_CHARS} characters]`
        : result.stdout;

    return ok(truncated);
  }
}
