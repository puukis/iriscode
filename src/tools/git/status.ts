import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { ok, toJson } from '../result.ts';
import { isGitRepo, runGit } from './utils.ts';

export class GitStatusTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'git-status',
    description: 'Show a structured summary of staged, unstaged, and untracked git changes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };

  async execute(
    _input: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    if (!(await isGitRepo(context.cwd))) {
      return ok(
        toJson({
          isGitRepo: false,
          message: 'Current directory is not a git repository.',
          staged: [],
          unstaged: [],
          untracked: [],
        }),
      );
    }

    const result = await runGit(['status', '--porcelain'], context.cwd);
    const summary = parsePorcelainStatus(result.stdout);

    return ok(
      toJson({
        isGitRepo: true,
        staged: summary.staged,
        unstaged: summary.unstaged,
        untracked: summary.untracked,
      }),
    );
  }
}

function parsePorcelainStatus(output: string): {
  staged: string[];
  unstaged: string[];
  untracked: string[];
} {
  const staged = new Set<string>();
  const unstaged = new Set<string>();
  const untracked = new Set<string>();

  for (const line of output.split('\n')) {
    if (!line) continue;
    const x = line[0] ?? ' ';
    const y = line[1] ?? ' ';
    const file = line.slice(3).trim();

    if (x === '?' && y === '?') {
      untracked.add(file);
      continue;
    }

    if (x !== ' ') staged.add(file);
    if (y !== ' ') unstaged.add(file);
  }

  return {
    staged: Array.from(staged).sort(),
    unstaged: Array.from(unstaged).sort(),
    untracked: Array.from(untracked).sort(),
  };
}
