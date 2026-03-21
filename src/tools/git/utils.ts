export interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
  try {
    const proc = Bun.spawn(['git', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { exitCode, stdout, stderr };
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  return result.exitCode === 0 && result.stdout.trim() === 'true';
}
