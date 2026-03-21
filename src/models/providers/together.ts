import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import { streamOpenAICompat } from '../openai-compat.ts';
import type { StreamEvent, StreamParams } from '../../shared/types.ts';
import { ProviderError } from '../../shared/errors.ts';

export class TogetherAdapter extends BaseAdapter {
  readonly provider = 'together';
  readonly modelId: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(modelId: string, apiKey?: string, baseUrl?: string) {
    super();
    const key = apiKey ?? process.env.TOGETHER_API_KEY;
    if (!key) throw new ProviderError('API key required. Set TOGETHER_API_KEY.', 'together');
    this.modelId = modelId;
    this.apiKey = key;
    this.baseUrl = baseUrl ?? process.env.TOGETHER_BASE_URL ?? 'https://api.together.xyz/v1';
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    yield* streamOpenAICompat(
      { baseUrl: this.baseUrl, apiKey: this.apiKey, modelId: this.modelId, provider: 'together' },
      params,
    );
  }

  async countTokens(_params: StreamParams): Promise<number> { return 0; }

  computeCost(inputTokens: number, outputTokens: number): TokenCost {
    const pricing: Record<string, { in: number; out: number }> = {
      'meta-llama/Llama-3.3-70B-Instruct-Turbo': { in: 0.00088, out: 0.00088 },
      'mistralai/Mixtral-8x7B-Instruct-v0.1':    { in: 0.0006, out: 0.0006 },
    };
    const p = pricing[this.modelId] ?? { in: 0, out: 0 };
    const inputCostUsd = (inputTokens / 1000) * p.in;
    const outputCostUsd = (outputTokens / 1000) * p.out;
    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }
}
