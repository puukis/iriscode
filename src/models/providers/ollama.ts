import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import type { StreamEvent, StreamParams, Message } from '../../shared/types.ts';
import { ProviderError, isAbortError } from '../../shared/errors.ts';

const DEFAULT_BASE_URL = 'http://localhost:11434';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_name?: string;
  tool_calls?: Array<{
    type: 'function';
    function: {
      index: number;
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
}

interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
  done_reason?: string;
  eval_count?: number;
  prompt_eval_count?: number;
}

export class OllamaAdapter extends BaseAdapter {
  readonly provider = 'ollama';
  readonly modelId: string;
  private baseUrl: string;

  constructor(modelId: string, baseUrl?: string) {
    super();
    this.modelId = modelId;
    this.baseUrl = baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    const { messages, systemPrompt, tools, maxTokens, abortSignal } = params;

    const ollamaMessages = historyToOllama(messages, systemPrompt);

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: ollamaMessages,
      stream: true,
      ...(maxTokens ? { options: { num_predict: maxTokens } } : {}),
      ...(tools.length > 0
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              },
            })),
          }
        : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw err;
      }
      throw new ProviderError(
        `Failed to connect to Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        'ollama',
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError(
        `Ollama API error ${response.status}: ${text}`,
        'ollama',
      );
    }

    if (!response.body) {
      throw new ProviderError('Ollama response has no body', 'ollama');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let promptTokens = 0;
    let evalTokens = 0;
    let stopReason = 'end_turn';
    const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let chunk: OllamaStreamChunk;
          try {
            chunk = JSON.parse(trimmed) as OllamaStreamChunk;
          } catch {
            continue; // skip malformed lines
          }

          if (chunk.message?.content) {
            yield { type: 'text', text: chunk.message.content };
          }

          if (chunk.message?.tool_calls) {
            for (const tc of chunk.message.tool_calls) {
              toolCalls.push({
                name: tc.function.name,
                arguments: tc.function.arguments,
              });
            }
          }

          if (chunk.done) {
            if (chunk.prompt_eval_count !== undefined) promptTokens = chunk.prompt_eval_count;
            if (chunk.eval_count !== undefined) evalTokens = chunk.eval_count;
            if (chunk.done_reason) stopReason = chunk.done_reason;
          }
        }
      }

      for (let index = 0; index < toolCalls.length; index++) {
        const tc = toolCalls[index];
        yield {
          type: 'tool_call',
          toolCall: {
            id: `ollama-tc-${Date.now()}-${index}`,
            name: tc.name,
            input: tc.arguments,
          },
        };
      }

      yield {
        type: 'done',
        stopReason: toolCalls.length > 0 ? 'tool_use' : stopReason,
        inputTokens: promptTokens,
        outputTokens: evalTokens,
      };
    } catch (err) {
      if (isAbortError(err)) {
        throw err;
      }
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        `Ollama stream error: ${err instanceof Error ? err.message : String(err)}`,
        'ollama',
      );
    } finally {
      reader.releaseLock();
    }
  }

  async countTokens(_params: StreamParams): Promise<number> {
    // Ollama has no token count endpoint; return 0 as a stub
    return 0;
  }

  computeCost(_inputTokens: number, _outputTokens: number): TokenCost {
    // Local models are free
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
  }

  /** Fetch available models from the local Ollama instance */
  async fetchModels(): Promise<string[]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/tags`);
    } catch (err) {
      throw new ProviderError(
        `Failed to connect to Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        'ollama',
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError(
        `Ollama tags API error ${response.status}: ${text}`,
        'ollama',
      );
    }

    const data = (await response.json()) as unknown;
    if (
      typeof data !== 'object' ||
      data === null ||
      !Array.isArray((data as Record<string, unknown>).models)
    ) {
      throw new ProviderError('Unexpected response shape from Ollama /api/tags', 'ollama');
    }
    return ((data as { models: Array<{ name: string }> }).models).map((m) => m.name);
  }
}

function historyToOllama(messages: Message[], systemPrompt?: string): OllamaMessage[] {
  const result: OllamaMessage[] = [];
  const toolNamesById = new Map<string, string>();

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const message of messages) {
    if (typeof message.content === 'string') continue;
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        toolNamesById.set(block.id, block.name);
      }
    }
  }

  for (const m of messages) {
    if (m.role === 'system') continue; // system prompt handled above

    if (typeof m.content === 'string') {
      result.push({ role: m.role, content: m.content });
      continue;
    }

    const textContent = m.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    const toolUses = m.content.filter((block) => block.type === 'tool_use');
    if (toolUses.length > 0) {
      const assistantMessage: OllamaMessage = {
        role: 'assistant',
        tool_calls: toolUses.map((block, index) => {
          if (block.type !== 'tool_use') {
            throw new Error('unreachable');
          }
          return {
            type: 'function',
            function: {
              index,
              name: block.name,
              arguments: block.input,
            },
          };
        }),
      };
      if (textContent) {
        assistantMessage.content = textContent;
      }
      result.push(assistantMessage);
    } else if (textContent) {
      result.push({ role: m.role, content: textContent });
    }

    for (const block of m.content) {
      if (block.type !== 'tool_result') continue;
      result.push({
        role: 'tool',
        tool_name: toolNamesById.get(block.tool_use_id) ?? block.tool_use_id,
        content: block.content,
      });
    }
  }

  return result;
}
