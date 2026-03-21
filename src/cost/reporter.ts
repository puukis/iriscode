import type { CostTotal } from './tracker.ts';

/**
 * Format a cost summary for display.
 * Example:
 *   anthropic/claude-sonnet-4-6 | in: 1,234 | out: 567 | $0.004521
 */
export function formatCostReport(total: CostTotal): string {
  if (total.entries.length === 0) {
    return 'No cost data for this session.';
  }

  const lines: string[] = [];

  // Per-model breakdown
  const byModel = new Map<string, { inputTokens: number; outputTokens: number; costUsd: number }>();
  for (const e of total.entries) {
    const key = `${e.provider}/${e.model}`;
    const existing = byModel.get(key) ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    byModel.set(key, {
      inputTokens: existing.inputTokens + e.inputTokens,
      outputTokens: existing.outputTokens + e.outputTokens,
      costUsd: existing.costUsd + e.costUsd,
    });
  }

  for (const [key, data] of byModel) {
    lines.push(
      `${key} | in: ${data.inputTokens.toLocaleString()} | out: ${data.outputTokens.toLocaleString()} | $${data.costUsd.toFixed(6)}`,
    );
  }

  lines.push(`─────────────────────────────────────────────────────────────`);
  lines.push(
    `Total: in: ${total.inputTokens.toLocaleString()} | out: ${total.outputTokens.toLocaleString()} | $${total.costUsd.toFixed(6)}`,
  );

  return lines.join('\n');
}
