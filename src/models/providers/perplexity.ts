import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import { streamOpenAICompat } from '../openai-compat.ts';
import type { StreamEvent, StreamParams } from '../../shared/types.ts';
import { ProviderError } from '../../shared/errors.ts';

export class PerplexityAdapter extends BaseAdapter {
  readonly provider = 'perplexity';
  readonly modelId: string;
  private apiKey: string;

  constructor(modelId: string, apiKey?: string) {
    super();
    const key = apiKey ?? process.env.PERPLEXITY_API_KEY;
    if (!key) throw new ProviderError('API key required. Set PERPLEXITY_API_KEY.', 'perplexity');
    this.modelId = modelId;
    this.apiKey = key;
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    yield* streamOpenAICompat(
      { baseUrl: 'https://api.perplexity.ai', apiKey: this.apiKey, modelId: this.modelId, provider: 'perplexity' },
      params,
    );
  }

  async countTokens(_params: StreamParams): Promise<number> { return 0; }

  computeCost(inputTokens: number, outputTokens: number): TokenCost {
    const pricing: Record<string, { in: number; out: number }> = {
      'sonar-pro':       { in: 0.003, out: 0.015 },
      'sonar':           { in: 0.001, out: 0.001 },
      'sonar-reasoning': { in: 0.001, out: 0.005 },
    };
    const p = pricing[this.modelId] ?? { in: 0, out: 0 };
    const inputCostUsd = (inputTokens / 1000) * p.in;
    const outputCostUsd = (outputTokens / 1000) * p.out;
    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }
}
