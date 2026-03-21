import { describe, expect, test } from 'bun:test';
import { BashTool } from '../bash.ts';
import { expectError, expectOk, makeToolContext } from '../../../shared/test-helpers.ts';

describe('shell tools', () => {
  test('bash returns stdout for successful commands', async () => {
    const result = await new BashTool().execute({ command: 'printf "shell-ok"' }, makeToolContext());
    expectOk(result);
    expect(result.content).toBe('shell-ok');
  });

  test('bash returns an error result for invalid input', async () => {
    const result = await new BashTool().execute({ command: '' }, makeToolContext());
    expectError(result);
    expect(result.content).toContain('command must be a non-empty string');
  });
});
