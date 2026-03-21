import { describe, expect, test } from 'bun:test';
import { createDefaultRegistry } from '../../index.ts';
import { expectOk, makeToolContext } from '../../../shared/test-helpers.ts';
import { ToolSearchTool } from '../tool-search.ts';

describe('discovery tools', () => {
  test('tool-search finds matching tools in the registry', async () => {
    const registry = createDefaultRegistry({ currentModel: 'anthropic/claude-sonnet-4-6' });
    const result = await new ToolSearchTool().execute(
      { query: 'git' },
      makeToolContext({ registry }),
    );

    expectOk(result);
    expect(result.content).toContain('git-status');
    expect(result.content).toContain('git-commit');
  });
});
