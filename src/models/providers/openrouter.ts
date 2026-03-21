import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import { streamOpenAICompat } from '../openai-compat.ts';
import type { StreamEvent, StreamParams } from '../../shared/types.ts';
import { ProviderError } from '../../shared/errors.ts';

export class OpenRouterAdapter extends BaseAdapter {
  readonly provider = 'openrouter';
  readonly modelId: string;
  private apiKey: string;

  constructor(modelId: string, apiKey?: string) {
    super();
    const key = apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!key) throw new ProviderError('API key required. Set OPENROUTER_API_KEY.', 'openrouter');
    this.modelId = modelId;
    this.apiKey = key;
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    yield* streamOpenAICompat(
      {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: this.apiKey,
        modelId: this.modelId,
        provider: 'openrouter',
        extraHeaders: { 'HTTP-Referer': 'https://iriscode.dev' },
      },
      params,
    );
  }

  async countTokens(_params: StreamParams): Promise<number> { return 0; }

  computeCost(_inputTokens: number, _outputTokens: number): TokenCost {
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
  }
}
