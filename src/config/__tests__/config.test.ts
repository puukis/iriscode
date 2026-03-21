import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { loadConfig } from '../loader.ts';
import { loadProjectConfig, PROJECT_SETTINGS_FILE, PROJECT_STATE_DIR } from '../project.ts';
import { loadUserConfig, writeUserConfig } from '../user.ts';
import { cleanupDir, makeTempDir, withCwd, withEnv, writeFile } from '../../shared/test-helpers.ts';

describe('config', () => {
  test('loadConfig reads .env from cwd and applies defaults', async () => {
    const cwd = makeTempDir('iriscode-config-');
    const home = makeTempDir('iriscode-config-home-');
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
        HOME: home,
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
          expect(config.mode).toBe('default');
          expect(loadProjectConfig(cwd)).toMatchObject({
            mode: 'default',
          });
          expect(Bun.file(join(cwd, PROJECT_STATE_DIR, PROJECT_SETTINGS_FILE)).size).toBeGreaterThan(0);
          expect(Bun.file(join(cwd, '.iris', '.gitignore')).size).toBeGreaterThan(0);
        });
      },
    );

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('project and user config loaders parse permission settings', async () => {
    const cwd = makeTempDir('iriscode-config-project-');
    const home = makeTempDir('iriscode-config-home-');
    writeFile(
      join(cwd, PROJECT_STATE_DIR, PROJECT_SETTINGS_FILE),
      JSON.stringify({
        mode: 'acceptEdits',
        permissions: {
          allow: ['Read(/tmp/demo.txt)', 'Write(src/index.ts)'],
          deny: ['GitCommit'],
        },
      }, null, 2),
    );

    await withEnv({ HOME: home }, async () => {
      writeUserConfig({
        mode: 'plan',
        allowed_tools: ['bash:echo'],
        disallowed_tools: ['bash:rm'],
      });

      const projectConfig = loadProjectConfig(cwd);
      const userConfig = loadUserConfig();

      expect(projectConfig.mode).toBe('acceptEdits');
      expect(projectConfig.allowed_tools).toEqual(['Read(/tmp/demo.txt)', 'Write(src/index.ts)']);
      expect(projectConfig.disallowed_tools).toEqual(['GitCommit']);
      expect(userConfig.mode).toBe('plan');
      expect(userConfig.allowed_tools).toEqual(['bash:echo']);
      expect(userConfig.disallowed_tools).toEqual(['bash:rm']);
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });
});
