import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import { streamOpenAICompat } from '../openai-compat.ts';
import type { StreamEvent, StreamParams } from '../../shared/types.ts';
import { ProviderError } from '../../shared/errors.ts';

export class DeepSeekAdapter extends BaseAdapter {
  readonly provider = 'deepseek';
  readonly modelId: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(modelId: string, apiKey?: string, baseUrl?: string) {
    super();
    const key = apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!key) throw new ProviderError('API key required. Set DEEPSEEK_API_KEY.', 'deepseek');
    this.modelId = modelId;
    this.apiKey = key;
    this.baseUrl = baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    yield* streamOpenAICompat(
      { baseUrl: this.baseUrl, apiKey: this.apiKey, modelId: this.modelId, provider: 'deepseek' },
      params,
    );
  }

  async countTokens(_params: StreamParams): Promise<number> { return 0; }

  computeCost(inputTokens: number, outputTokens: number): TokenCost {
    const pricing: Record<string, { in: number; out: number }> = {
      'deepseek-chat':     { in: 0.00027, out: 0.0011 },
      'deepseek-reasoner': { in: 0.00055, out: 0.00219 },
    };
    const p = pricing[this.modelId] ?? { in: 0, out: 0 };
    const inputCostUsd = (inputTokens / 1000) * p.in;
    const outputCostUsd = (outputTokens / 1000) * p.out;
    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }
}
