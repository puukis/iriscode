import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import { streamOpenAICompat } from '../openai-compat.ts';
import type { StreamEvent, StreamParams } from '../../shared/types.ts';
import { ProviderError } from '../../shared/errors.ts';

export class XAIAdapter extends BaseAdapter {
  readonly provider = 'xai';
  readonly modelId: string;
  private apiKey: string;

  constructor(modelId: string, apiKey?: string) {
    super();
    const key = apiKey ?? process.env.XAI_API_KEY;
    if (!key) throw new ProviderError('API key required. Set XAI_API_KEY.', 'xai');
    this.modelId = modelId;
    this.apiKey = key;
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    yield* streamOpenAICompat(
      { baseUrl: 'https://api.x.ai/v1', apiKey: this.apiKey, modelId: this.modelId, provider: 'xai' },
      params,
    );
  }

  async countTokens(_params: StreamParams): Promise<number> { return 0; }

  computeCost(inputTokens: number, outputTokens: number): TokenCost {
    const pricing: Record<string, { in: number; out: number }> = {
      'grok-3':      { in: 0.003, out: 0.015 },
      'grok-3-mini': { in: 0.0003, out: 0.0005 },
      'grok-2':      { in: 0.002, out: 0.01 },
    };
    const p = pricing[this.modelId] ?? { in: 0, out: 0 };
    const inputCostUsd = (inputTokens / 1000) * p.in;
    const outputCostUsd = (outputTokens / 1000) * p.out;
    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }
}
