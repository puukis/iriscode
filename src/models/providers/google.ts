import { BaseAdapter, type TokenCost } from '../base-adapter.ts';
import type { StreamEvent, StreamParams, Message } from '../../shared/types.ts';
import { ProviderError, isAbortError } from '../../shared/errors.ts';

const BASE_URL = 'https://generativelanguage.googleapis.com';

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{
    text?: string;
    functionCall?: { name: string; args: Record<string, unknown> };
    functionResponse?: { name: string; response: Record<string, unknown> };
  }>;
}

interface GeminiChunk {
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: Array<{
        text?: string;
        functionCall?: { name: string; args: Record<string, unknown> };
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export class GoogleAdapter extends BaseAdapter {
  readonly provider = 'google';
  readonly modelId: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(modelId: string, apiKey?: string, baseUrl?: string) {
    super();
    const key = apiKey ?? process.env.GOOGLE_API_KEY;
    if (!key) {
      throw new ProviderError(
        'API key required. Set GOOGLE_API_KEY environment variable.',
        'google',
      );
    }
    this.modelId = modelId;
    this.apiKey = key;
    this.baseUrl = baseUrl ?? process.env.GOOGLE_BASE_URL ?? BASE_URL;
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    const { messages, systemPrompt, tools, maxTokens = 4096, abortSignal } = params;
    const contents = messagesToGemini(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    };

    if (systemPrompt) {
      body['systemInstruction'] = { parts: [{ text: systemPrompt }] };
    }

    if (tools.length > 0) {
      body['tools'] = [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
      }];
    }

    const url = `${this.baseUrl}/v1beta/models/${this.modelId}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    let response: Response;
    try {
      response = await fetch(url, {
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
        `Failed to connect: ${err instanceof Error ? err.message : String(err)}`,
        'google',
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError(`API error ${response.status}: ${text}`, 'google');
    }

    if (!response.body) throw new ProviderError('Response has no body', 'google');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

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
          if (!data || data === '[DONE]') continue;

          let chunk: GeminiChunk;
          try {
            chunk = JSON.parse(data) as GeminiChunk;
          } catch {
            continue;
          }

          if (chunk.usageMetadata) {
            inputTokens = chunk.usageMetadata.promptTokenCount ?? 0;
            outputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
          }

          for (const candidate of chunk.candidates ?? []) {
            for (const part of candidate.content?.parts ?? []) {
              if (part.text) {
                yield { type: 'text', text: part.text };
              }
              if (part.functionCall) {
                toolCalls.push(part.functionCall);
              }
            }
          }
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        throw err;
      }
      throw new ProviderError(
        `Google stream error: ${err instanceof Error ? err.message : String(err)}`,
        'google',
        err,
      );
    } finally {
      reader.releaseLock();
    }

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      yield {
        type: 'tool_call',
        toolCall: {
          id: `gemini-tc-${Date.now()}-${i}`,
          name: tc.name,
          input: tc.args,
        },
      };
    }

    yield {
      type: 'done',
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      inputTokens,
      outputTokens,
    };
  }

  async countTokens(_params: StreamParams): Promise<number> {
    return 0;
  }

  computeCost(inputTokens: number, outputTokens: number): TokenCost {
    const pricing: Record<string, { in: number; out: number }> = {
      'gemini-2.5-pro':    { in: 0.00125, out: 0.01 },
      'gemini-2.5-flash':  { in: 0.000075, out: 0.0003 },
      'gemini-2.0-flash':  { in: 0.0001, out: 0.0004 },
    };
    const p = pricing[this.modelId] ?? { in: 0, out: 0 };
    const inputCostUsd = (inputTokens / 1000) * p.in;
    const outputCostUsd = (outputTokens / 1000) * p.out;
    return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
  }
}

function messagesToGemini(messages: Message[]): GeminiContent[] {
  const result: GeminiContent[] = [];

  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'user' ? 'user' : 'model';

    if (typeof m.content === 'string') {
      result.push({ role, parts: [{ text: m.content }] });
      continue;
    }

    const parts: GeminiContent['parts'] = [];
    for (const b of m.content) {
      if (b.type === 'text') {
        parts.push({ text: b.text });
      } else if (b.type === 'tool_use') {
        parts.push({ functionCall: { name: b.name, args: b.input } });
      } else if (b.type === 'tool_result') {
        parts.push({
          functionResponse: {
            name: b.tool_use_id,
            response: { output: b.content },
          },
        });
      }
    }

    if (parts.length > 0) result.push({ role, parts });
  }

  return result;
}
