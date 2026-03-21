import { describe, expect, test } from 'bun:test';
import { buildStartupSummary, estimateContextTokens } from '../startup-summary.ts';

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
});
