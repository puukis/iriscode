import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { loadConfig } from '../loader.ts';
import { cleanupDir, makeTempDir, withCwd, withEnv, writeFile } from '../../shared/test-helpers.ts';

describe('config', () => {
  test('loadConfig reads .env from cwd and applies defaults', async () => {
    const cwd = makeTempDir('iriscode-config-');
    writeFile(
      join(cwd, '.env'),
      [
        'OPENAI_API_KEY=test-openai',
        'IRISCODE_DEFAULT_MODEL=openai/gpt-4o-mini',
        'LOG_LEVEL=debug',
      ].join('\n'),
    );

    await withEnv(
      {
        OPENAI_API_KEY: undefined,
        IRISCODE_DEFAULT_MODEL: undefined,
        LOG_LEVEL: undefined,
      },
      async () => {
        await withCwd(cwd, async () => {
          const config = loadConfig();
          expect(config.openaiApiKey).toBe('test-openai');
          expect(config.defaultModel).toBe('openai/gpt-4o-mini');
          expect(config.logLevel).toBe('debug');
        });
      },
    );

    cleanupDir(cwd);
  });
});
