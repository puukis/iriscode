import Anthropic from '@anthropic-ai/sdk';
import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import type { StreamEvent, StreamParams, Message, ContentBlock } from '../../shared/types.ts';

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
    this.modelId = modelId;
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    const { messages, systemPrompt, tools } = params;

    const anthropicMessages = historyToAnthropic(messages);

    const streamParams: Anthropic.MessageStreamParams = {
      model: this.modelId,
      max_tokens: 4096,
      messages: anthropicMessages,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(tools && tools.length > 0
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

    for await (const event of streamHandle) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }
    }

    const final = await streamHandle.finalMessage();

    // Emit tool calls from final message
    for (const block of final.content) {
      if (block.type === 'tool_use') {
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
  }

  async countTokens(params: StreamParams): Promise<number> {
    const messages = historyToAnthropic(params.messages);
    const result = await this.client.messages.countTokens({
      model: this.modelId,
      messages,
      ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
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

function historyToAnthropic(history: Message[]): Anthropic.MessageParam[] {
  return history
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
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
  // tool_result
  return {
    type: 'tool_result',
    tool_use_id: block.tool_use_id,
    content: block.content,
    ...(block.is_error ? { is_error: true } : {}),
  };
}
