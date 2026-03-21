import { bus } from '../shared/events.ts';
import { getPricing } from './pricing.ts';

export interface CostEntry {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface CostTotal {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  entries: CostEntry[];
}

export class CostTracker {
  private entries: CostEntry[] = [];
  private readonly onEntry?: (entry: CostEntry) => void;

  constructor(onEntry?: (entry: CostEntry) => void) {
    this.onEntry = onEntry;
  }

  add(provider: string, model: string, inputTokens: number, outputTokens: number): void {
    const pricing = getPricing(provider, model);
    const costUsd =
      (inputTokens / 1000) * pricing.inputPer1k +
      (outputTokens / 1000) * pricing.outputPer1k;

    const entry: CostEntry = { provider, model, inputTokens, outputTokens, costUsd };
    this.recordEntry(entry);
  }

  total(): CostTotal {
    return this.entries.reduce(
      (acc, e) => ({
        inputTokens: acc.inputTokens + e.inputTokens,
        outputTokens: acc.outputTokens + e.outputTokens,
        costUsd: acc.costUsd + e.costUsd,
        entries: [...acc.entries, e],
      }),
      { inputTokens: 0, outputTokens: 0, costUsd: 0, entries: [] as CostEntry[] },
    );
  }

  reset(): void {
    this.entries = [];
  }

  restore(entries: CostEntry[]): void {
    this.entries = [...entries];
  }

  recordEntry(entry: CostEntry): void {
    this.entries.push(entry);
    this.onEntry?.(entry);

    bus.emit('cost:update', {
      provider: entry.provider,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalCostUsd: this.total().costUsd,
    });
  }
}

/** Singleton shared across the session */
export const costTracker = new CostTracker();
