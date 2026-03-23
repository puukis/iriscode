import { describe, expect, test } from 'bun:test';
import { buildMcpStartupSummary, buildStartupSummary, estimateContextTokens } from '../startup-summary.ts';

describe('startup summary', () => {
  test('estimates zero tokens when no context is loaded', () => {
    expect(estimateContextTokens('')).toBe(0);
    expect(estimateContextTokens('   \n  ')).toBe(0);
  });

  test('counts loaded context text in the memory summary', () => {
    const summary = buildStartupSummary(
      'ollama/gpt-oss:20b-cloud',
      'default',
      10000,
      'Persisted project memory:\n- user age (.iris/memory/user_age.txt): I am 14 years old.',
    );

    expect(summary).toContain('model: ollama/gpt-oss:20b-cloud');
    expect(summary).toContain('mode: default');
    expect(summary).not.toContain('memory: 0/10,000 tokens');
    expect(summary).toMatch(/memory: \d+\/10,000 tokens/);
  });

  test('formats plan mode with the dry-run label', () => {
    expect(buildStartupSummary('openai/gpt-4o-mini', 'plan', 10000, 'hello')).toContain(
      'mode: plan (dry run)',
    );
  });

  test('formats MCP startup summaries from connected servers', () => {
    expect(buildMcpStartupSummary([
      {
        config: { name: 'filesystem', type: 'stdio', command: 'npx', args: [], enabled: true, required: false },
        status: 'connected',
        tools: Array.from({ length: 12 }, (_, index) => ({
          name: `tool-${index}`,
          description: '',
          inputSchema: { type: 'object', properties: {} },
          serverName: 'filesystem',
        })),
      },
      {
        config: { name: 'github', type: 'http', url: 'https://example.com/mcp', enabled: true, required: false },
        status: 'connected',
        tools: Array.from({ length: 8 }, (_, index) => ({
          name: `tool-${index}`,
          description: '',
          inputSchema: { type: 'object', properties: {} },
          serverName: 'github',
        })),
      },
    ])).toBe('MCP: filesystem (12 tools), github (8 tools)');
  });
});
