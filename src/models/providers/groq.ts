import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import { streamOpenAICompat } from '../openai-compat.ts';
import type { StreamEvent, StreamParams } from '../../shared/types.ts';
import { ProviderError } from '../../shared/errors.ts';

export class GroqAdapter extends BaseAdapter {
  readonly provider = 'groq';
  readonly modelId: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(modelId: string, apiKey?: string, baseUrl?: string) {
    super();
    const key = apiKey ?? process.env.GROQ_API_KEY;
    if (!key) throw new ProviderError('API key required. Set GROQ_API_KEY.', 'groq');
    this.modelId = modelId;
    this.apiKey = key;
    this.baseUrl = baseUrl ?? process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1';
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    yield* streamOpenAICompat(
      { baseUrl: this.baseUrl, apiKey: this.apiKey, modelId: this.modelId, provider: 'groq' },
      params,
    );
  }

  async countTokens(_params: StreamParams): Promise<number> { return 0; }

  computeCost(inputTokens: number, outputTokens: number): TokenCost {
    const pricing: Record<string, { in: number; out: number }> = {
      'llama-3.3-70b-versatile': { in: 0.00059, out: 0.00079 },
      'llama-3.1-8b-instant':    { in: 0.00005, out: 0.00008 },
      'mixtral-8x7b-32768':      { in: 0.00024, out: 0.00024 },
    };
    const p = pricing[this.modelId] ?? { in: 0, out: 0 };
    const inputCostUsd = (inputTokens / 1000) * p.in;
    const outputCostUsd = (outputTokens / 1000) * p.out;
    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }
}
