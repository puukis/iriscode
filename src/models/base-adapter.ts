import type { StreamEvent, StreamParams } from '../shared/types.ts';

export interface TokenCost {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

export abstract class BaseAdapter {
  abstract readonly provider: string;
  abstract readonly modelId: string;

  abstract stream(params: StreamParams): AsyncGenerator<StreamEvent>;

  abstract countTokens(params: StreamParams): Promise<number>;

  abstract computeCost(inputTokens: number, outputTokens: number): TokenCost;
}
