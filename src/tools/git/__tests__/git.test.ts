import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { cleanupDir, expectOk, makeTempDir, makeToolContext, runGitSync, writeFile } from '../../../shared/test-helpers.ts';
import { GitCommitTool } from '../commit.ts';
import { GitDiffTool } from '../diff.ts';
import { GitStatusTool } from '../status.ts';
import { isGitRepo, runGit } from '../utils.ts';

describe('git tools', () => {
  test('git helpers run commands and detect repositories', async () => {
    const cwd = makeTempDir('iriscode-git-utils-');
    runGitSync(['init'], cwd);

    expect(await isGitRepo(cwd)).toBe(true);
    const result = await runGit(['status', '--porcelain'], cwd);
    expect(result.exitCode).toBe(0);

    cleanupDir(cwd);
  });

  test('git status, diff, and commit operate on a temp repo', async () => {
    const cwd = makeTempDir('iriscode-git-tools-');
    runGitSync(['init'], cwd);
    runGitSync(['config', 'user.name', 'IrisCode Test'], cwd);
    runGitSync(['config', 'user.email', 'tests@example.com'], cwd);
    writeFile(join(cwd, 'tracked.txt'), 'base\n');
    runGitSync(['add', 'tracked.txt'], cwd);
    runGitSync(['commit', '-m', 'baseline'], cwd);

    const context = makeToolContext({ cwd });
    const noChanges = await new GitCommitTool().execute({ message: 'noop' }, context);
    expectOk(noChanges);
    expect(noChanges.content).toContain('No changes to commit');

    writeFile(join(cwd, 'tracked.txt'), 'base\nnext\n');
    writeFile(join(cwd, 'new.txt'), 'new file\n');

    const statusResult = await new GitStatusTool().execute({}, context);
    expectOk(statusResult);
    const status = JSON.parse(statusResult.content) as { unstaged: string[]; untracked: string[] };
    expect(status.unstaged).toContain('tracked.txt');
    expect(status.untracked).toContain('new.txt');

    const diffResult = await new GitDiffTool().execute({ staged: false, file: 'tracked.txt' }, context);
    expectOk(diffResult);
    expect(diffResult.content).toContain('+next');

    const commitResult = await new GitCommitTool().execute({ message: 'checkpoint test' }, context);
    expectOk(commitResult);
    const commit = JSON.parse(commitResult.content) as { hash: string; summary: string };
    expect(commit.hash.length).toBeGreaterThan(7);
    expect(commit.summary.length).toBeGreaterThan(0);

    cleanupDir(cwd);
  });
});
