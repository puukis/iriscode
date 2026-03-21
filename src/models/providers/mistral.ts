import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import { streamOpenAICompat } from '../openai-compat.ts';
import type { StreamEvent, StreamParams } from '../../shared/types.ts';
import { ProviderError } from '../../shared/errors.ts';

export class MistralAdapter extends BaseAdapter {
  readonly provider = 'mistral';
  readonly modelId: string;
  private apiKey: string;

  constructor(modelId: string, apiKey?: string) {
    super();
    const key = apiKey ?? process.env.MISTRAL_API_KEY;
    if (!key) throw new ProviderError('API key required. Set MISTRAL_API_KEY.', 'mistral');
    this.modelId = modelId;
    this.apiKey = key;
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    yield* streamOpenAICompat(
      { baseUrl: 'https://api.mistral.ai/v1', apiKey: this.apiKey, modelId: this.modelId, provider: 'mistral' },
      params,
    );
  }

  async countTokens(_params: StreamParams): Promise<number> { return 0; }

  computeCost(inputTokens: number, outputTokens: number): TokenCost {
    const pricing: Record<string, { in: number; out: number }> = {
      'mistral-large-latest': { in: 0.003, out: 0.009 },
      'mistral-small-latest': { in: 0.0002, out: 0.0006 },
      'codestral-latest':     { in: 0.0003, out: 0.0009 },
    };
    const p = pricing[this.modelId] ?? { in: 0, out: 0 };
    const inputCostUsd = (inputTokens / 1000) * p.in;
    const outputCostUsd = (outputTokens / 1000) * p.out;
    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }
}
