import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

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

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const command = input['command'];
    if (typeof command !== 'string' || !command) {
      return fail('bash', 'command must be a non-empty string');
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
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
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
      return fail(
        'bash',
        `bash error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const exitCode = await proc.exited;
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    if (exitCode !== 0) {
      return ok(`Exit code: ${exitCode}\n${combined}`);
    }
    return ok(combined || '(no output)');
  }
}
