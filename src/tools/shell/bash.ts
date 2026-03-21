import { Tool } from '../index.ts';
import type { ToolDefinitionSchema } from '../../shared/types.ts';
import { ToolError } from '../../shared/errors.ts';

const DEFAULT_TIMEOUT_MS = 30_000;

export class BashTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'bash',
    description: 'Run a bash command and return its output.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to run' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
      },
      required: ['command'],
    },
  };

  async execute(input: Record<string, unknown>): Promise<string> {
    const command = input['command'];
    if (typeof command !== 'string' || !command) {
      throw new ToolError('command must be a non-empty string', 'bash');
    }
    const timeoutMs =
      typeof input['timeout_ms'] === 'number' ? input['timeout_ms'] : DEFAULT_TIMEOUT_MS;

    const proc = Bun.spawn(['bash', '-c', command], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => {
        proc.kill();
        reject(new ToolError(`Command timed out after ${timeoutMs}ms`, 'bash'));
      }, timeoutMs),
    );

    let stdout = '';
    let stderr = '';
    try {
      [stdout, stderr] = await Promise.race([
        Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]),
        timeout,
      ]);
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw new ToolError(
        `bash error: ${err instanceof Error ? err.message : String(err)}`,
        'bash',
      );
    }

    const exitCode = await proc.exited;
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    if (exitCode !== 0) {
      return `Exit code: ${exitCode}\n${combined}`;
    }
    return combined || '(no output)';
  }
}
