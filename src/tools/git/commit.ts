import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok, toJson } from '../result.ts';
import { isGitRepo, runGit } from './utils.ts';

export class GitCommitTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'git-commit',
    description: 'Stage all git changes and create a commit with the provided message.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
      },
      required: ['message'],
    },
  };

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const message = typeof input['message'] === 'string' ? input['message'].trim() : '';
    if (!message) {
      return fail('git-commit', 'message must be a non-empty string');
    }

    if (!(await isGitRepo(context.cwd))) {
      return fail('git-commit', 'Current directory is not a git repository');
    }

    const status = await runGit(['status', '--porcelain'], context.cwd);
    if (!status.stdout.trim()) {
      return ok('No changes to commit.');
    }

    const addResult = await runGit(['add', '-A'], context.cwd);
    if (addResult.exitCode !== 0) {
      return fail('git-commit', addResult.stderr.trim() || 'git add -A failed');
    }

    const commitResult = await runGit(['commit', '-m', message], context.cwd);
    if (commitResult.exitCode !== 0) {
      return fail('git-commit', commitResult.stderr.trim() || commitResult.stdout.trim() || 'git commit failed');
    }

    const hashResult = await runGit(['rev-parse', 'HEAD'], context.cwd);
    if (hashResult.exitCode !== 0) {
      return fail('git-commit', hashResult.stderr.trim() || 'Failed to read commit hash');
    }

    return ok(
      toJson({
        hash: hashResult.stdout.trim(),
        summary: firstNonEmptyLine(commitResult.stdout) ?? firstNonEmptyLine(commitResult.stderr) ?? 'Commit created.',
      }),
    );
  }
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
}
