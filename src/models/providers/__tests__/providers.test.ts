import { describe, expect, test } from 'bun:test';
import { OllamaAdapter } from '../ollama.ts';
import { OpenAIAdapter } from '../openai.ts';
import { isAbortError } from '../../../shared/errors.ts';
import { makeJsonStreamResponse, withMockFetch } from '../../../shared/test-helpers.ts';

describe('model providers', () => {
  test('OpenAIAdapter streams text, tool calls, and usage', async () => {
    await withMockFetch(
      (async () =>
        makeJsonStreamResponse([
          'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read","arguments":"{\\"path\\":\\"a.txt\\"}"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"world"}}],"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\n',
          'data: [DONE]\n\n',
        ])) as unknown as typeof fetch,
      async () => {
        const adapter = new OpenAIAdapter('gpt-4o-mini', 'test-key');
        const events = [];
        for await (const event of adapter.stream({
          messages: [{ role: 'user', content: 'test' }],
          tools: [{ name: 'read', description: 'read', inputSchema: { type: 'object', properties: {} } }],
          systemPrompt: 'sys',
          maxTokens: 16,
        })) {
          events.push(event);
        }

        expect(events.some((event) => event.type === 'text' && event.text?.includes('hello'))).toBe(true);
        expect(events.some((event) => event.type === 'tool_call')).toBe(true);
        expect(events.some((event) => event.type === 'done' && event.inputTokens === 3)).toBe(true);
      },
    );
  });

  test('OllamaAdapter fetchModels returns installed model names', async () => {
    await withMockFetch(
      (async (input) => {
        expect(String(input)).toContain('/api/tags');
        return Response.json({
          models: [{ name: 'llama3.2' }, { name: 'qwen2.5-coder' }],
        });
      }) as typeof fetch,
      async () => {
        const adapter = new OllamaAdapter('__probe__', 'http://localhost:11434');
        await expect(adapter.fetchModels()).resolves.toEqual(['llama3.2', 'qwen2.5-coder']);
      },
    );
  });

  test('OllamaAdapter sends assistant tool_calls and tool results using Ollama chat format', async () => {
    let requestBody: Record<string, unknown> | undefined;

    await withMockFetch(
      (async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return makeJsonStreamResponse([
          '{"message":{"role":"assistant","content":"Here is your answer."},"done":true,"done_reason":"stop","prompt_eval_count":8,"eval_count":5}\n',
        ]);
      }) as typeof fetch,
      async () => {
        const adapter = new OllamaAdapter('qwen3', 'http://localhost:11434');
        const events = [];
        for await (const event of adapter.stream({
          messages: [
            { role: 'user', content: 'What is the temperature in Berlin?' },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'call-1',
                  name: 'get_temperature',
                  input: { city: 'Berlin' },
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'call-1',
                  content: '22°C',
                },
              ],
            },
          ],
          tools: [
            {
              name: 'get_temperature',
              description: 'Get the current temperature for a city',
              inputSchema: {
                type: 'object',
                properties: {
                  city: { type: 'string' },
                },
                required: ['city'],
              },
            },
          ],
          systemPrompt: 'You are helpful.',
        })) {
          events.push(event);
        }

        expect(requestBody).toBeDefined();
        expect(requestBody?.messages).toEqual([
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'What is the temperature in Berlin?' },
          {
            role: 'assistant',
            tool_calls: [
              {
                type: 'function',
                function: {
                  index: 0,
                  name: 'get_temperature',
                  arguments: { city: 'Berlin' },
                },
              },
            ],
          },
          { role: 'tool', tool_name: 'get_temperature', content: '22°C' },
        ]);
        expect(events.some((event) => event.type === 'text' && event.text === 'Here is your answer.')).toBe(true);
      },
    );
  });

  test('OllamaAdapter reports tool_use when the streamed response contains tool calls', async () => {
    await withMockFetch(
      (async () =>
        makeJsonStreamResponse([
          '{"message":{"role":"assistant","tool_calls":[{"function":{"name":"read","arguments":{"path":"README.md"}}}]},"done":false}\n',
          '{"done":true,"done_reason":"stop","prompt_eval_count":3,"eval_count":1}\n',
        ])) as unknown as typeof fetch,
      async () => {
        const adapter = new OllamaAdapter('qwen3', 'http://localhost:11434');
        const events = [];
        for await (const event of adapter.stream({
          messages: [{ role: 'user', content: 'Read the README.' }],
          tools: [
            {
              name: 'read',
              description: 'Read a file',
              inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            },
          ],
        })) {
          events.push(event);
        }

        expect(events.some((event) => event.type === 'tool_call' && event.toolCall?.name === 'read')).toBe(true);
        expect(events.some((event) => event.type === 'done' && event.stopReason === 'tool_use')).toBe(true);
      },
    );
  });

  test('OllamaAdapter propagates aborts instead of wrapping them as provider errors', async () => {
    const controller = new AbortController();

    await withMockFetch(
      (async (_input, init) =>
        new Promise<Response>((_, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        })) as typeof fetch,
      async () => {
        const adapter = new OllamaAdapter('qwen3', 'http://localhost:11434');
        const run = (async () => {
          for await (const _event of adapter.stream({
            messages: [{ role: 'user', content: 'hello' }],
            tools: [],
            abortSignal: controller.signal,
          })) {
            // no-op
          }
        })();

        controller.abort();
        let aborted = false;
        try {
          await run;
        } catch (error) {
          aborted = isAbortError(error);
        }

        expect(aborted).toBe(true);
      },
    );
  });
});
