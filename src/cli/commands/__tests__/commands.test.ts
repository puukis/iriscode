import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'path';
import { runCostCommand } from '../cost.ts';
import { runModelsCommand } from '../models.ts';
import { costTracker } from '../../../cost/tracker.ts';
import {
  cleanupDir,
  captureConsole,
  makeTempDir,
  withCwd,
  withEnv,
  withMockFetch,
  writeFile,
} from '../../../shared/test-helpers.ts';

describe('cli commands', () => {
  afterEach(() => {
    costTracker.reset();
  });

  test('runCostCommand prints the current session cost report', async () => {
    costTracker.add('anthropic', 'claude-sonnet-4-6', 1000, 1000);
    const output = await captureConsole(() => runCostCommand());
    expect(output).toContain('IrisCode — Session Cost');
    expect(output).toContain('anthropic/claude-sonnet-4-6');
  });

  test('runModelsCommand lists configured providers and Ollama models', async () => {
    const cwd = makeTempDir('iriscode-models-command-');
    const home = makeTempDir('iriscode-models-home-');
    writeFile(join(cwd, '.env'), 'OPENAI_API_KEY=test-openai\nOPENROUTER_API_KEY=test-openrouter\n');
    await withEnv(
      {
        HOME: home,
        OPENAI_API_KEY: undefined,
        OPENROUTER_API_KEY: undefined,
      },
      async () => {
        await withCwd(cwd, async () => {
          await withMockFetch(
            (async (input) => {
              const url = String(input);
              if (url.includes('/api/tags')) {
                return Response.json({ models: [{ name: 'llama3.2' }] });
              }
              throw new Error(`Unexpected fetch: ${url}`);
            }) as typeof fetch,
            async () => {
              const output = await captureConsole(() => runModelsCommand());
              expect(output).toContain('openai/gpt-4o-mini');
              expect(output).toContain('openrouter/(any model string)');
              expect(output).toContain('ollama/llama3.2');
            },
          );
        });
      },
    );

    cleanupDir(cwd);
    cleanupDir(home);
  });
});
