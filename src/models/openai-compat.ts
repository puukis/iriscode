import type { StreamEvent, StreamParams, Message } from '../shared/types.ts';
import { ProviderError, isAbortError } from '../shared/errors.ts';

export interface OpenAICompatOptions {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  provider: string; // used in ProviderError messages
  extraHeaders?: Record<string, string>;
}

interface OAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OAIChunk {
  choices: Array<{
    delta: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export async function* streamOpenAICompat(
  opts: OpenAICompatOptions,
  params: StreamParams,
): AsyncGenerator<StreamEvent> {
  const { baseUrl, apiKey, modelId, provider, extraHeaders } = opts;
  const { messages, systemPrompt, tools, maxTokens = 4096, abortSignal } = params;

  const oaiMessages = messagesToOAI(messages, systemPrompt);

  const body: Record<string, unknown> = {
    model: modelId,
    messages: oaiMessages,
    stream: true,
    stream_options: { include_usage: true },
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
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    throw new ProviderError(
      `Failed to connect to ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      provider,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ProviderError(`API error ${response.status}: ${text}`, provider);
  }

  if (!response.body) throw new ProviderError('Response has no body', provider);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;

  // Accumulate tool call fragments indexed by tool_calls[n].index
  const toolCallAccum: Map<
    number,
    { id: string; name: string; arguments: string }
  > = new Map();

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
        if (data === '[DONE]') continue;

        let chunk: OAIChunk;
        try {
          chunk = JSON.parse(data) as OAIChunk;
        } catch {
          continue;
        }

        // Usage (arrives in last chunk with stream_options)
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta.content) {
          yield { type: 'text', text: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccum.has(idx)) {
              toolCallAccum.set(idx, { id: '', name: '', arguments: '' });
            }
            const accum = toolCallAccum.get(idx)!;
            if (tc.id) accum.id = tc.id;
            if (tc.function?.name) accum.name = tc.function.name;
            if (tc.function?.arguments) accum.arguments += tc.function.arguments;
          }
        }
      }
    }
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    throw new ProviderError(
      `Stream error: ${err instanceof Error ? err.message : String(err)}`,
      provider,
      err,
    );
  } finally {
    reader.releaseLock();
  }

  // Emit accumulated tool calls
  for (const [, tc] of toolCallAccum) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tc.arguments) as Record<string, unknown>;
    } catch {
      input = { _raw: tc.arguments };
    }
    yield {
      type: 'tool_call',
      toolCall: { id: tc.id, name: tc.name, input },
    };
  }

  yield {
    type: 'done',
    stopReason: toolCallAccum.size > 0 ? 'tool_use' : 'end_turn',
    inputTokens,
    outputTokens,
  };
}

function messagesToOAI(messages: Message[], systemPrompt?: string): OAIMessage[] {
  const result: OAIMessage[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (typeof m.content === 'string') {
      result.push({ role: m.role as OAIMessage['role'], content: m.content });
      continue;
    }

    // ContentBlock array
    const toolUseBlocks = m.content.filter((b) => b.type === 'tool_use');
    const toolResultBlocks = m.content.filter((b) => b.type === 'tool_result');
    const textBlocks = m.content.filter((b) => b.type === 'text');

    if (toolResultBlocks.length > 0) {
      // tool results → one message per result
      for (const b of toolResultBlocks) {
        if (b.type !== 'tool_result') continue;
        result.push({
          role: 'tool',
          content: b.content,
          tool_call_id: b.tool_use_id,
        });
      }
      continue;
    }

    if (toolUseBlocks.length > 0) {
      // assistant message with tool_calls
      const textContent = textBlocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
      result.push({
        role: 'assistant',
        content: textContent || null,
        tool_calls: toolUseBlocks
          .filter((b) => b.type === 'tool_use')
          .map((b) => {
            if (b.type !== 'tool_use') throw new Error('unreachable');
            return {
              id: b.id,
              type: 'function' as const,
              function: { name: b.name, arguments: JSON.stringify(b.input) },
            };
          }),
      });
      continue;
    }

    const text = textBlocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    result.push({ role: m.role as OAIMessage['role'], content: text });
  }

  return result;
}
