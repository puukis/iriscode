import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'path';
import { getConfig, loadConfig, resetConfigCacheForTests } from '../loader.ts';
import { getApiKey, loadSecrets, setApiKey } from '../secrets.ts';
import {
  cleanupDir,
  captureStderr,
  makeTempDir,
  withEnv,
  writeFile,
} from '../../shared/test-helpers.ts';

describe('config loader', () => {
  afterEach(() => {
    process.exitCode = 0;
    resetConfigCacheForTests();
  });

  test('merging global config and project config applies correct precedence', async () => {
    const cwd = makeTempDir('iriscode-loader-project-');
    const home = makeTempDir('iriscode-loader-home-');

    writeFile(
      join(home, '.iris', 'config.toml'),
      [
        'default_model = "openai/gpt-4o-mini"',
        '',
        '[permissions]',
        'mode = "plan"',
        '',
        '[memory]',
        'max_tokens = 12000',
      ].join('\n'),
    );
    writeFile(
      join(cwd, 'IRIS.md'),
      [
        '# Project',
        '',
        '## Config',
        '',
        '```yaml',
        'model: anthropic/claude-haiku-4-5',
        'permissions:',
        '  mode: acceptEdits',
        '```',
      ].join('\n'),
    );

    await withEnv({ HOME: home }, async () => {
      resetConfigCacheForTests();
      const config = await loadConfig(cwd);
      expect(config.default_model).toBe('openai/gpt-4o-mini');
      expect(config.model).toBe('anthropic/claude-haiku-4-5');
      expect(config.permissions.mode).toBe('acceptEdits');
      expect(config.memory.max_tokens).toBe(12000);
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('a project allowed_tools list overrides the global one', async () => {
    const cwd = makeTempDir('iriscode-loader-project-');
    const home = makeTempDir('iriscode-loader-home-');

    writeFile(
      join(home, '.iris', 'config.toml'),
      [
        '[permissions]',
        'allowed_tools = ["Read(/tmp/**)"]',
      ].join('\n'),
    );
    writeFile(
      join(cwd, 'IRIS.md'),
      [
        '# Project',
        '',
        '## Config',
        '',
        '```yaml',
        'permissions:',
        '  allowed_tools: [Bash(echo *)]',
        '```',
      ].join('\n'),
    );

    await withEnv({ HOME: home }, async () => {
      resetConfigCacheForTests();
      const config = await loadConfig(cwd);
      expect(config.permissions.allowed_tools).toEqual(['Bash(echo *)']);
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('missing API key returns undefined not an error', async () => {
    const cwd = makeTempDir('iriscode-loader-project-');
    const home = makeTempDir('iriscode-loader-home-');

    await withEnv({ HOME: home, OPENAI_API_KEY: undefined }, async () => {
      resetConfigCacheForTests();
      await loadSecrets(cwd);
      expect(getApiKey('openai')).toBeUndefined();
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('invalid IRIS.md config block prints a clear error and does not return a partial config', async () => {
    const cwd = makeTempDir('iriscode-loader-project-');
    const home = makeTempDir('iriscode-loader-home-');

    writeFile(
      join(cwd, 'IRIS.md'),
      [
        '# Broken',
        '',
        '## Config',
        '',
        '```yaml',
        'permissions:',
        '  mode: definitely-not-valid',
        '```',
      ].join('\n'),
    );

    await withEnv({ HOME: home }, async () => {
      resetConfigCacheForTests();
      const stderr = await captureStderr(async () => {
        await expect(loadConfig(cwd)).rejects.toThrow();
      });

      expect(stderr).toContain('Project config');
      expect(stderr).toContain('permissions.mode');
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('getConfig before loadConfig throws', () => {
    resetConfigCacheForTests();
    expect(() => getConfig()).toThrow('Call loadConfig() first');
  });

  test('setApiKey writes to ~/.iris/config.toml and is readable back via getApiKey', async () => {
    const cwd = makeTempDir('iriscode-loader-project-');
    const home = makeTempDir('iriscode-loader-home-');

    await withEnv({ HOME: home, OPENAI_API_KEY: undefined }, async () => {
      resetConfigCacheForTests();
      await setApiKey('openai', 'test-openai-key');
      await loadSecrets(cwd);

      expect(getApiKey('openai')).toBe('test-openai-key');
      expect(Bun.file(join(home, '.iris', 'config.toml')).size).toBeGreaterThan(0);
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('loadConfig includes persisted .iris memory in context_text', async () => {
    const cwd = makeTempDir('iriscode-loader-project-');
    const home = makeTempDir('iriscode-loader-home-');

    writeFile(join(cwd, '.iris', 'memory', 'user_age.txt'), 'I am 14 years old.');
    writeFile(join(cwd, '.iris', 'memory', 'assistant-name.txt'), 'Your name is Thomas.');

    await withEnv({ HOME: home }, async () => {
      resetConfigCacheForTests();
      const config = await loadConfig(cwd);
      expect(config.context_text).toContain('Persisted project memory:');
      expect(config.context_text).toContain('user age (.iris/memory/user_age.txt): I am 14 years old.');
      expect(config.context_text).toContain('assistant name (.iris/memory/assistant-name.txt): Your name is Thomas.');
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('loadConfig includes nested IRIS.md context even when the project root has no IRIS.md', async () => {
    const cwd = makeTempDir('iriscode-loader-nested-context-');
    const home = makeTempDir('iriscode-loader-home-');

    writeFile(
      join(cwd, 'src', 'IRIS.md'),
      [
        '# API layer',
        '',
        'Routes live here.',
      ].join('\n'),
    );

    await withEnv({ HOME: home }, async () => {
      resetConfigCacheForTests();
      const config = await loadConfig(cwd);
      expect(config.context_text).toContain('# API layer');
      expect(config.context_text).toContain('Routes live here.');
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('loadConfig merges global and project MCP server lists by name', async () => {
    const cwd = makeTempDir('iriscode-loader-mcp-project-');
    const home = makeTempDir('iriscode-loader-mcp-home-');

    writeFile(
      join(home, '.iris', 'config.toml'),
      [
        'mcp_oauth_callback_port = 7777',
        '',
        '[[mcp_servers]]',
        'name = "filesystem"',
        'type = "stdio"',
        'command = "npx"',
        'args = ["-y", "@modelcontextprotocol/server-filesystem", "."]',
      ].join('\n'),
    );
    writeFile(
      join(cwd, 'IRIS.md'),
      [
        '# MCP',
        '',
        '## Config',
        '',
        '```yaml',
        'mcp_servers:',
        '  - name: github',
        '    type: http',
        '    url: https://example.com/mcp',
        '    bearer_token_env_var: GITHUB_TOKEN',
        '```',
      ].join('\n'),
    );

    await withEnv({ HOME: home }, async () => {
      resetConfigCacheForTests();
      const config = await loadConfig(cwd);
      expect(config.mcp_oauth_callback_port).toBe(7777);
      expect(config.mcp_servers).toHaveLength(2);
      expect(config.mcp_servers.map((server) => server.name)).toEqual(['filesystem', 'github']);
      expect(config.mcp_servers.find((server) => server.name === 'filesystem')?.type).toBe('stdio');
      expect(config.mcp_servers.find((server) => server.name === 'github')?.type).toBe('http');
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });
});
