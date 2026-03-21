import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import { streamOpenAICompat } from '../openai-compat.ts';
import type { StreamEvent, StreamParams } from '../../shared/types.ts';
import { ProviderError } from '../../shared/errors.ts';

export class FireworksAdapter extends BaseAdapter {
  readonly provider = 'fireworks';
  readonly modelId: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(modelId: string, apiKey?: string, baseUrl?: string) {
    super();
    const key = apiKey ?? process.env.FIREWORKS_API_KEY;
    if (!key) throw new ProviderError('API key required. Set FIREWORKS_API_KEY.', 'fireworks');
    this.modelId = modelId;
    this.apiKey = key;
    this.baseUrl = baseUrl ?? process.env.FIREWORKS_BASE_URL ?? 'https://api.fireworks.ai/inference/v1';
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    yield* streamOpenAICompat(
      { baseUrl: this.baseUrl, apiKey: this.apiKey, modelId: this.modelId, provider: 'fireworks' },
      params,
    );
  }

  async countTokens(_params: StreamParams): Promise<number> { return 0; }

  computeCost(inputTokens: number, outputTokens: number): TokenCost {
    const pricing: Record<string, { in: number; out: number }> = {
      'accounts/fireworks/models/llama-v3p3-70b-instruct': { in: 0.0009, out: 0.0009 },
      'accounts/fireworks/models/deepseek-r1':             { in: 0.003, out: 0.008 },
    };
    const p = pricing[this.modelId] ?? { in: 0, out: 0 };
    const inputCostUsd = (inputTokens / 1000) * p.in;
    const outputCostUsd = (outputTokens / 1000) * p.out;
    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }
}
