import { afterEach, describe, expect, test } from 'bun:test';
import { formatCostReport } from '../reporter.ts';
import { costTracker, CostTracker } from '../tracker.ts';
import { bus } from '../../shared/events.ts';

describe('cost', () => {
  afterEach(() => {
    costTracker.reset();
  });

  test('CostTracker aggregates entries and emits updates', () => {
    const tracker = new CostTracker();
    const updates: number[] = [];
    const off = bus.on('cost:update', ({ totalCostUsd }) => updates.push(totalCostUsd));

    tracker.add('anthropic', 'claude-sonnet-4-6', 1000, 2000);
    tracker.add('openai', 'gpt-4o-mini', 500, 500);

    const total = tracker.total();
    expect(total.entries.length).toBe(2);
    expect(total.inputTokens).toBe(1500);
    expect(total.outputTokens).toBe(2500);
    expect(updates.length).toBe(2);

    off();
  });

  test('formatCostReport renders empty and populated summaries', () => {
    expect(formatCostReport({ inputTokens: 0, outputTokens: 0, costUsd: 0, entries: [] })).toBe(
      'No cost data for this session.',
    );

    costTracker.add('anthropic', 'claude-haiku-4-5', 2000, 1000);
    const report = formatCostReport(costTracker.total());
    expect(report).toContain('anthropic/claude-haiku-4-5');
    expect(report).toContain('Total:');
  });
});
