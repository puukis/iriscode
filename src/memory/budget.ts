import type { IrisHierarchyResult, IrisSource } from './loader.ts';

export const MEMORY_TOKEN_LIMIT = 10_000;
export const MEMORY_WARN_AT = 8_000;
export const MEMORY_MAX_LINES = 200;

/** Average token-per-line estimate used to convert memory line count to tokens */
const TOKENS_PER_MEMORY_LINE = 8;

export interface BudgetResult {
  totalTokens: number;
  status: 'ok' | 'warning' | 'exceeded';
  message: string;
  largestFiles: Array<{ path: string; tokens: number }>;
}

/**
 * Checks total memory token usage against budget limits.
 * @param hierarchy - IRIS.md hierarchy result with per-file token counts
 * @param memoryLines - total lines of MEMORY.md content being injected
 */
export function checkBudget(hierarchy: IrisHierarchyResult, memoryLines: number): BudgetResult {
  const memoryTokens = memoryLines * TOKENS_PER_MEMORY_LINE;
  const totalTokens = hierarchy.totalTokens + memoryTokens;

  const status: BudgetResult['status'] =
    totalTokens >= MEMORY_TOKEN_LIMIT
      ? 'exceeded'
      : totalTokens >= MEMORY_WARN_AT
        ? 'warning'
        : 'ok';

  const message = `[memory: ${totalTokens.toLocaleString()} / ${MEMORY_TOKEN_LIMIT.toLocaleString()} tokens]`;

  const largestFiles: Array<{ path: string; tokens: number }> = [...hierarchy.sources]
    .sort((a: IrisSource, b: IrisSource) => b.tokens - a.tokens)
    .slice(0, 3)
    .map((source: IrisSource) => ({ path: source.path, tokens: source.tokens }));

  return { totalTokens, status, message, largestFiles };
}
