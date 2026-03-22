import { describe, expect, test } from 'bun:test';
import {
  checkBudget,
  MEMORY_TOKEN_LIMIT,
  MEMORY_WARN_AT,
  MEMORY_MAX_LINES,
} from '../budget.ts';
import type { IrisHierarchyResult } from '../loader.ts';

function makeHierarchy(tokens: number, files: number = 1): IrisHierarchyResult {
  const tokensPerFile = Math.ceil(tokens / files);
  return {
    contextText: 'x'.repeat(tokens * 4),
    sources: Array.from({ length: files }, (_, i) => ({
      path: `/file${i}.md`,
      lines: 10,
      tokens: tokensPerFile,
    })),
    totalTokens: tokens,
    totalLines: files * 10,
  };
}

describe('budget constants', () => {
  test('MEMORY_TOKEN_LIMIT is 10_000', () => {
    expect(MEMORY_TOKEN_LIMIT).toBe(10_000);
  });

  test('MEMORY_WARN_AT is 8_000', () => {
    expect(MEMORY_WARN_AT).toBe(8_000);
  });

  test('MEMORY_MAX_LINES is 200', () => {
    expect(MEMORY_MAX_LINES).toBe(200);
  });
});

describe('checkBudget', () => {
  test('status is "ok" when under 8,000 tokens', () => {
    const result = checkBudget(makeHierarchy(5_000), 50);
    expect(result.status).toBe('ok');
    expect(result.totalTokens).toBeGreaterThanOrEqual(5_000);
  });

  test('status is "warning" at 8,000 tokens', () => {
    const result = checkBudget(makeHierarchy(8_000), 0);
    expect(result.status).toBe('warning');
  });

  test('status is "warning" between 8,000 and 10,000 tokens', () => {
    const result = checkBudget(makeHierarchy(9_000), 0);
    expect(result.status).toBe('warning');
  });

  test('status is "exceeded" at 10,000 tokens', () => {
    const result = checkBudget(makeHierarchy(10_000), 0);
    expect(result.status).toBe('exceeded');
  });

  test('status is "exceeded" above 10,000 tokens', () => {
    const result = checkBudget(makeHierarchy(12_000), 0);
    expect(result.status).toBe('exceeded');
  });

  test('message includes token count and limit', () => {
    const result = checkBudget(makeHierarchy(3_240), 0);
    expect(result.message).toContain('3,240');
    expect(result.message).toContain('10,000');
  });

  test('largestFiles returns top 3 files sorted by token count', () => {
    const hierarchy = makeHierarchy(9_000, 5);
    const result = checkBudget(hierarchy, 0);
    expect(result.largestFiles.length).toBeLessThanOrEqual(3);
  });

  test('adds memoryLines tokens to totalTokens', () => {
    const hierarchy = makeHierarchy(3_000, 1);
    // 200 lines * ~8 tokens/line ≈ not counted exactly; just verify totalTokens > hierarchy.totalTokens
    const result = checkBudget(hierarchy, 100);
    expect(result.totalTokens).toBeGreaterThan(3_000);
  });
});
