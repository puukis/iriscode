import Anthropic from '@anthropic-ai/sdk';
import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import type { StreamEvent, StreamParams, Message, ContentBlock } from '../../shared/types.ts';
import { ProviderError } from '../../shared/errors.ts';

// Pricing per 1M tokens
const PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'claude-opus-4-6': { inputPer1M: 5.0, outputPer1M: 25.0 },
  'claude-sonnet-4-6': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-haiku-4-5': { inputPer1M: 1.0, outputPer1M: 5.0 },
  'default': { inputPer1M: 3.0, outputPer1M: 15.0 },
};

export class AnthropicAdapter extends BaseAdapter {
  readonly provider = 'anthropic';
  readonly modelId: string;
  private client: Anthropic;

  constructor(modelId: string, apiKey?: string) {
    super();
    const resolvedKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!resolvedKey) {
      throw new ProviderError(
        'API key is required. Provide apiKey or set ANTHROPIC_API_KEY.',
        'anthropic',
      );
    }
    this.modelId = modelId;
    this.client = new Anthropic({ apiKey: resolvedKey });
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    const { messages, systemPrompt, tools, maxTokens = 4096 } = params;

    const anthropicMessages = historyToAnthropic(messages);

    const streamParams: Anthropic.MessageStreamParams = {
      model: this.modelId,
      max_tokens: maxTokens,
      messages: anthropicMessages,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(tools.length > 0
        ? {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
          }
        : {}),
    };

    const streamHandle = this.client.messages.stream(streamParams);

    try {
      for await (const event of streamHandle) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }

      const final = await streamHandle.finalMessage();

      // Emit tool calls from final message
      for (const block of final.content) {
        if (block.type === 'tool_use') {
          if (typeof block.input !== 'object' || block.input === null) {
            throw new ProviderError('tool_use block has non-object input', 'anthropic');
          }
          yield {
            type: 'tool_call',
            toolCall: {
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            },
          };
        }
      }

      yield {
        type: 'done',
        stopReason: final.stop_reason ?? 'end_turn',
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        err instanceof Error ? err.message : String(err),
        'anthropic',
      );
    }
  }

  async countTokens(params: StreamParams): Promise<number> {
    const messages = historyToAnthropic(params.messages);
    const result = await this.client.messages.countTokens({
      model: this.modelId,
      messages,
      ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
      ...(params.tools.length > 0
        ? {
            tools: params.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
          }
        : {}),
    });
    return result.input_tokens;
  }

  computeCost(inputTokens: number, outputTokens: number): TokenCost {
    const pricing = PRICING[this.modelId] ?? PRICING['default'];
    const inputCostUsd = (inputTokens / 1_000_000) * pricing.inputPer1M;
    const outputCostUsd = (outputTokens / 1_000_000) * pricing.outputPer1M;
    return {
      inputCostUsd,
      outputCostUsd,
      totalCostUsd: inputCostUsd + outputCostUsd,
    };
  }
}

function isUserOrAssistant(m: Message): m is Message & { role: 'user' | 'assistant' } {
  return m.role === 'user' || m.role === 'assistant';
}

function historyToAnthropic(history: Message[]): Anthropic.MessageParam[] {
  return history.filter(isUserOrAssistant).map((m) => ({
    role: m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content.map((block) => contentBlockToAnthropic(block)),
  }));
}

function contentBlockToAnthropic(block: ContentBlock): Anthropic.ContentBlockParam {
  if (block.type === 'text') {
    return { type: 'text', text: block.text };
  }
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.input,
    };
  }
  if (block.type === 'tool_result') {
    return {
      type: 'tool_result',
      tool_use_id: block.tool_use_id,
      content: block.content,
      ...(block.is_error ? { is_error: true } : {}),
    };
  }
  // TypeScript exhaustiveness guard — ContentBlock union should be fully handled above
  const _exhaustive: never = block;
  throw new ProviderError(
    `Unknown content block type: ${(_exhaustive as { type: string }).type}`,
    'anthropic',
  );
}
