import { describe, expect, test } from 'bun:test';
import { existsSync } from 'fs';
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
          const config = await loadConfig();
          expect(config.providers.openai.apiKey).toBe('test-openai');
          expect(config.default_model).toBe('openai/gpt-4o-mini');
          expect(config.log_level).toBe('debug');
          expect(config.permissions.mode).toBe('default');
          expect(config.context_text).toBe('');
          expect(existsSync(join(cwd, 'IRIS.md'))).toBe(false);
          await expect(loadProjectConfig(cwd)).resolves.toMatchObject({
            config: {},
          });
          expect(existsSync(join(cwd, 'IRIS.md'))).toBe(false);
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
      join(cwd, 'IRIS.md'),
      [
        '# Demo',
        '',
        '## Config',
        '',
        '```yaml',
        'model: openai/gpt-4o-mini',
        'permissions:',
        '  mode: acceptEdits',
        '  allowed_tools: [Read(/tmp/demo.txt), Write(src/index.ts)]',
        '  disallowed_tools: [GitCommit]',
        '```',
      ].join('\n'),
    );

    await withEnv({ HOME: home }, async () => {
      writeUserConfig({
        permissions: {
          mode: 'plan',
          allowed_tools: ['bash:echo'],
          disallowed_tools: ['bash:rm'],
        },
      });

      const projectConfig = await loadProjectConfig(cwd);
      const userConfig = loadUserConfig();

      expect(projectConfig.config.permissions?.mode).toBe('acceptEdits');
      expect(projectConfig.config.permissions?.allowed_tools).toEqual(['Read(/tmp/demo.txt)', 'Write(src/index.ts)']);
      expect(projectConfig.config.permissions?.disallowed_tools).toEqual(['GitCommit']);
      expect(userConfig.permissions?.mode).toBe('plan');
      expect(userConfig.permissions?.allowed_tools).toEqual(['bash:echo']);
      expect(userConfig.permissions?.disallowed_tools).toEqual(['bash:rm']);
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });
});
