import { describe, expect, test } from 'bun:test';
import { OllamaAdapter } from '../ollama.ts';
import { OpenAIAdapter } from '../openai.ts';
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
});
