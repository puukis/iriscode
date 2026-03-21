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

  add(provider: string, model: string, inputTokens: number, outputTokens: number): void {
    const pricing = getPricing(provider, model);
    const costUsd =
      (inputTokens / 1000) * pricing.inputPer1k +
      (outputTokens / 1000) * pricing.outputPer1k;

    const entry: CostEntry = { provider, model, inputTokens, outputTokens, costUsd };
    this.entries.push(entry);

    bus.emit('cost:update', {
      provider,
      model,
      inputTokens,
      outputTokens,
      totalCostUsd: this.total().costUsd,
    });
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
}

/** Singleton shared across the session */
export const costTracker = new CostTracker();
