import { describe, expect, test } from 'bun:test';
import { runRunCommand } from '../commands/run.ts';
import {
  captureStdout,
  makeJsonStreamResponse,
  withEnv,
  withMockFetch,
} from '../../shared/test-helpers.ts';

describe('cli', () => {
  test('runRunCommand streams plain text output', async () => {
    await withEnv(
      {
        OPENAI_API_KEY: 'test-key',
        IRISCODE_DEFAULT_MODEL: 'openai/gpt-4o-mini',
      },
      async () => {
        await withMockFetch(
          (async (input) => {
            const url = String(input);
            if (url.includes('/chat/completions')) {
              return makeJsonStreamResponse([
                'data: {"choices":[{"delta":{"content":"hello from run"}}],"usage":{"prompt_tokens":4,"completion_tokens":3}}\n\n',
                'data: [DONE]\n\n',
              ]);
            }
            throw new Error(`Unexpected fetch: ${url}`);
          }) as typeof fetch,
          async () => {
            const output = await captureStdout(() => runRunCommand(['Say hi', '--no-tools']));
            expect(output).toContain('hello from run');
          },
        );
      },
    );
  });

  test('runRunCommand emits jsonl with --json', async () => {
    await withEnv(
      {
        OPENAI_API_KEY: 'test-key',
        IRISCODE_DEFAULT_MODEL: 'openai/gpt-4o-mini',
      },
      async () => {
        await withMockFetch(
          (async (input) => {
            const url = String(input);
            if (url.includes('/chat/completions')) {
              return makeJsonStreamResponse([
                'data: {"choices":[{"delta":{"content":"json output"}}],"usage":{"prompt_tokens":2,"completion_tokens":2}}\n\n',
                'data: [DONE]\n\n',
              ]);
            }
            throw new Error(`Unexpected fetch: ${url}`);
          }) as typeof fetch,
          async () => {
            const output = await captureStdout(() => runRunCommand(['Explain this', '--json', '--no-tools']));
            const lines = output.trim().split('\n').map((line) => JSON.parse(line) as { type: string });
            expect(lines.some((line) => line.type === 'text')).toBe(true);
            expect(lines.some((line) => line.type === 'done')).toBe(true);
          },
        );
      },
    );
  });
});
