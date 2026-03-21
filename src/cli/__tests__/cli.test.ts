import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { runRunCommand } from '../commands/run.ts';
import {
  cleanupDir,
  captureStdout,
  makeTempDir,
  makeJsonStreamResponse,
  withCwd,
  withEnv,
  withMockFetch,
  writeFile,
} from '../../shared/test-helpers.ts';

describe('cli', () => {
  test('runRunCommand streams plain text output', async () => {
    const cwd = makeTempDir('iriscode-cli-run-');
    const home = makeTempDir('iriscode-cli-home-');
    writeFile(join(cwd, '.env'), 'OPENAI_API_KEY=test-key\nIRISCODE_DEFAULT_MODEL=openai/gpt-4o-mini\n');
    await withEnv(
      {
        HOME: home,
        OPENAI_API_KEY: undefined,
        IRISCODE_DEFAULT_MODEL: undefined,
      },
      async () => {
        await withCwd(cwd, async () => {
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
        });
      },
    );
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('runRunCommand emits jsonl with --json', async () => {
    const cwd = makeTempDir('iriscode-cli-json-');
    const home = makeTempDir('iriscode-cli-home-');
    writeFile(join(cwd, '.env'), 'OPENAI_API_KEY=test-key\nIRISCODE_DEFAULT_MODEL=openai/gpt-4o-mini\n');
    await withEnv(
      {
        HOME: home,
        OPENAI_API_KEY: undefined,
        IRISCODE_DEFAULT_MODEL: undefined,
      },
      async () => {
        await withCwd(cwd, async () => {
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
        });
      },
    );
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('runRunCommand supports plan mode in one-shot execution', async () => {
    const cwd = makeTempDir('iriscode-cli-plan-');
    const home = makeTempDir('iriscode-cli-home-');
    writeFile(join(cwd, '.env'), 'OPENAI_API_KEY=test-key\nIRISCODE_DEFAULT_MODEL=openai/gpt-4o-mini\n');
    await withEnv(
      {
        HOME: home,
        OPENAI_API_KEY: undefined,
        IRISCODE_DEFAULT_MODEL: undefined,
      },
      async () => {
        await withCwd(cwd, async () => {
          let callCount = 0;
          await withMockFetch(
            (async (input) => {
              const url = String(input);
              if (url.includes('/chat/completions')) {
                callCount += 1;
                if (callCount === 1) {
                  return makeJsonStreamResponse([
                    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"write","arguments":"{\\"path\\":\\"todo.md\\",\\"content\\":\\"draft\\"}"}}]}}]}\n\n',
                    'data: [DONE]\n\n',
                  ]);
                }

                return makeJsonStreamResponse([
                  'data: {"choices":[{"delta":{"content":"Plan drafted."}}],"usage":{"prompt_tokens":2,"completion_tokens":2}}\n\n',
                  'data: [DONE]\n\n',
                ]);
              }
              throw new Error(`Unexpected fetch: ${url}`);
            }) as typeof fetch,
            async () => {
              const output = await captureStdout(() => runRunCommand(['Make a plan', '--mode', 'plan']));
              expect(output).toContain('[PLAN MODE] Planned steps:');
            },
          );
        });
      },
    );

    cleanupDir(cwd);
    cleanupDir(home);
  });
});
