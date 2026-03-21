import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import { streamOpenAICompat } from '../openai-compat.ts';
import type { StreamEvent, StreamParams } from '../../shared/types.ts';
import { ProviderError } from '../../shared/errors.ts';

export class OpenAIAdapter extends BaseAdapter {
  readonly provider = 'openai';
  readonly modelId: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(modelId: string, apiKey?: string, baseUrl?: string) {
    super();
    const key = apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new ProviderError(
        'API key required. Set OPENAI_API_KEY environment variable.',
        'openai',
      );
    }
    this.modelId = modelId;
    this.apiKey = key;
    this.baseUrl = baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    yield* streamOpenAICompat(
      { baseUrl: this.baseUrl, apiKey: this.apiKey, modelId: this.modelId, provider: 'openai' },
      params,
    );
  }

  async countTokens(_params: StreamParams): Promise<number> {
    return 0;
  }

  computeCost(inputTokens: number, outputTokens: number): TokenCost {
    const pricing: Record<string, { in: number; out: number }> = {
      'gpt-4o':        { in: 0.0025, out: 0.01 },
      'gpt-4o-mini':   { in: 0.00015, out: 0.0006 },
      'gpt-4-turbo':   { in: 0.01, out: 0.03 },
      'o1':            { in: 0.015, out: 0.06 },
      'o3-mini':       { in: 0.0011, out: 0.0044 },
    };
    const p = pricing[this.modelId] ?? { in: 0, out: 0 };
    const inputCostUsd = (inputTokens / 1000) * p.in;
    const outputCostUsd = (outputTokens / 1000) * p.out;
    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }
}
