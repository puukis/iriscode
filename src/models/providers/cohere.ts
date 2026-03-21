import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import type { StreamEvent, StreamParams, Message } from '../../shared/types.ts';
import { ProviderError } from '../../shared/errors.ts';

interface CohereMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface CohereChunk {
  type: string;
  index?: number;
  // content-start: first chunk for a content block; contains metadata (type, id, name for tool-call)
  message?: {
    content?: Array<{
      type: string;
      id?: string;
      function?: { name: string; arguments: string };
    }>;
  };
  delta?: {
    message?: {
      content?: { type: string; text: string };
      // tool-call-chunk: partial arguments for a tool call
      'tool-call'?: { arguments?: string };
    };
    finish_reason?: string;
    usage?: { billed_units?: { input_tokens?: number; output_tokens?: number } };
  };
}

export class CohereAdapter extends BaseAdapter {
  readonly provider = 'cohere';
  readonly modelId: string;
  private apiKey: string;

  constructor(modelId: string, apiKey?: string) {
    super();
    const key = apiKey ?? process.env.COHERE_API_KEY;
    if (!key) throw new ProviderError('API key required. Set COHERE_API_KEY.', 'cohere');
    this.modelId = modelId;
    this.apiKey = key;
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    const { messages, systemPrompt, tools, maxTokens = 4096 } = params;

    const cohereMessages = messagesToCohere(messages, systemPrompt);

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: cohereMessages,
      stream: true,
      max_tokens: maxTokens,
    };

    if (tools.length > 0) {
      body['tools'] = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    let response: Response;
    try {
      response = await fetch('https://api.cohere.com/v2/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError(
        `Failed to connect: ${err instanceof Error ? err.message : String(err)}`,
        'cohere',
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError(`API error ${response.status}: ${text}`, 'cohere');
    }

    if (!response.body) throw new ProviderError('Response has no body', 'cohere');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;
    // toolCallAccum maps content block index → accumulated tool call data
    const toolCallAccum = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (!data) continue;

          let chunk: CohereChunk;
          try {
            chunk = JSON.parse(data) as CohereChunk;
          } catch {
            continue;
          }

          // Text streaming
          if (chunk.type === 'content-delta' && chunk.delta?.message?.content?.text) {
            yield { type: 'text', text: chunk.delta.message.content.text };
          }

          // Tool call metadata (id, name) arrives in content-start
          if (chunk.type === 'content-start' && chunk.index !== undefined) {
            const block = chunk.message?.content?.[0];
            if (block?.type === 'tool-call' && block.id && block.function?.name) {
              toolCallAccum.set(chunk.index, {
                id: block.id,
                name: block.function.name,
                arguments: block.function.arguments ?? '',
              });
            }
          }

          // Tool call arguments streamed in tool-call-chunk
          if (chunk.type === 'tool-call-chunk' && chunk.index !== undefined) {
            const accum = toolCallAccum.get(chunk.index);
            if (accum) {
              accum.arguments += chunk.delta?.message?.['tool-call']?.arguments ?? '';
            }
          }

          // Usage and finish reason in message-end
          if (chunk.type === 'message-end' && chunk.delta?.usage?.billed_units) {
            inputTokens = chunk.delta.usage.billed_units.input_tokens ?? 0;
            outputTokens = chunk.delta.usage.billed_units.output_tokens ?? 0;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls = Array.from(toolCallAccum.values());
    for (const tc of toolCalls) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(tc.arguments) as Record<string, unknown>; } catch { /* */ }
      yield { type: 'tool_call', toolCall: { id: tc.id, name: tc.name, input } };
    }

    yield {
      type: 'done',
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      inputTokens,
      outputTokens,
    };
  }

  async countTokens(_params: StreamParams): Promise<number> { return 0; }

  computeCost(inputTokens: number, outputTokens: number): TokenCost {
    const pricing: Record<string, { in: number; out: number }> = {
      'command-r-plus': { in: 0.0025, out: 0.01 },
      'command-r':      { in: 0.00015, out: 0.0006 },
    };
    const p = pricing[this.modelId] ?? { in: 0, out: 0 };
    const inputCostUsd = (inputTokens / 1000) * p.in;
    const outputCostUsd = (outputTokens / 1000) * p.out;
    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }
}

function messagesToCohere(messages: Message[], systemPrompt?: string): CohereMessage[] {
  const result: CohereMessage[] = [];

  if (systemPrompt) {
    result.push({ role: 'user', content: `System: ${systemPrompt}` });
    result.push({ role: 'assistant', content: 'Understood.' });
  }

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (typeof m.content === 'string') {
      result.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
      continue;
    }

    const toolResults = m.content.filter((b) => b.type === 'tool_result');
    if (toolResults.length > 0) {
      for (const b of toolResults) {
        if (b.type !== 'tool_result') continue;
        result.push({ role: 'tool', content: b.content, tool_call_id: b.tool_use_id });
      }
      continue;
    }

    const toolUses = m.content.filter((b) => b.type === 'tool_use');
    const texts = m.content.filter((b) => b.type === 'text');
    const textContent = texts.map((b) => (b.type === 'text' ? b.text : '')).join('');

    if (toolUses.length > 0) {
      result.push({
        role: 'assistant',
        content: textContent,
        tool_calls: toolUses
          .filter((b) => b.type === 'tool_use')
          .map((b) => {
            if (b.type !== 'tool_use') throw new Error('unreachable');
            return { id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } };
          }),
      });
    } else {
      result.push({ role: m.role === 'user' ? 'user' : 'assistant', content: textContent });
    }
  }

  return result;
}
