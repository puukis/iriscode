import { readFile } from 'fs/promises';
import { resolve } from 'path';
import type { CommandEntry, CommandResult } from '../types.ts';
import { readMarkdownCommandFile } from './shared.ts';

export async function runCustomCommand(
  entry: CommandEntry,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  try {
    if (!entry.source) {
      return {
        type: 'error',
        message: `Command "${entry.name}" has no source file.`,
      };
    }

    const parsed = await readMarkdownCommandFile(entry.source);
    let text = parsed.body;

    for (let index = 0; index < 9; index++) {
      const pattern = new RegExp(`\\$${index + 1}\\b`, 'g');
      text = text.replace(pattern, args[index] ?? '');
    }

    text = text.replace(/\$ARGUMENTS\b/g, args.join(' '));
    text = await expandFileReferences(text, cwd);
    text = await expandBashBlocks(text, cwd);

    return {
      type: 'prompt',
      text,
      allowedTools: entry.allowedTools,
      model: entry.model,
    };
  } catch (error) {
    return {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function expandFileReferences(text: string, cwd: string): Promise<string> {
  const matches = Array.from(text.matchAll(/(^|\s)@([^\s]+)/g));
  if (matches.length === 0) {
    return text;
  }

  let expanded = text;
  for (const match of matches) {
    const token = match[0].trim();
    const filePath = match[2];
    const absolutePath = resolve(cwd, filePath);
    try {
      const content = await readFile(absolutePath, 'utf-8');
      expanded = expanded.replace(
        token,
        `@${filePath}\n\n\`\`\`\n${content}\n\`\`\``,
      );
    } catch (error) {
      expanded = expanded.replace(
        token,
        `[Unable to read @${filePath}: ${error instanceof Error ? error.message : String(error)}]`,
      );
    }
  }

  return expanded;
}

async function expandBashBlocks(text: string, cwd: string): Promise<string> {
  const matches = Array.from(text.matchAll(/!`([^`]+)`/g));
  if (matches.length === 0) {
    return text;
  }

  let expanded = text;
  for (const match of matches) {
    const command = match[1];
    const output = await runCommandWithTimeout(command, cwd, 5000);
    expanded = expanded.replace(match[0], output);
  }

  return expanded;
}

async function runCommandWithTimeout(command: string, cwd: string, timeoutMs: number): Promise<string> {
  const proc = Bun.spawn(['sh', '-lc', command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  try {
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (timedOut) {
      return `[command timed out after ${Math.ceil(timeoutMs / 1000)}s: ${command}]`;
    }

    if (exitCode !== 0) {
      return `[command failed: ${command}\n${stderr.trim() || stdout.trim() || `exit ${exitCode}`}]`;
    }

    return stdout.trim() || `[command produced no output: ${command}]`;
  } catch {
    return `[command timed out after ${Math.ceil(timeoutMs / 1000)}s: ${command}]`;
  } finally {
    clearTimeout(timeout);
    try {
      proc.kill();
    } catch {
      // no-op
    }
  }
}
