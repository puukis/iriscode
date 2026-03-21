import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { readFileSync } from 'fs';
import { PermissionEngine } from '../engine.ts';
import { derivePersistentToolPattern, matchesToolPattern } from '../matcher.ts';
import { resolveRules } from '../tiers.ts';
import { PROJECT_SETTINGS_FILE, PROJECT_STATE_DIR } from '../../config/project.ts';
import {
  cleanupDir,
  makeTempDir,
  withEnv,
  writeFile,
} from '../../shared/test-helpers.ts';

describe('permissions', () => {
  test('matches exact, glob, and tool+input patterns', () => {
    const bashRequest = {
      toolName: 'bash',
      input: { command: 'rm -rf dist' },
      sessionId: 'session-1',
    };

    expect(matchesToolPattern(bashRequest, 'bash')).toBe(true);
    expect(matchesToolPattern({ ...bashRequest, toolName: 'git-diff' }, 'git-*')).toBe(true);
    expect(matchesToolPattern(bashRequest, 'bash:rm')).toBe(true);
    expect(matchesToolPattern(bashRequest, 'bash:cat')).toBe(false);
    expect(matchesToolPattern(bashRequest, 'Bash(rm -rf dist)')).toBe(true);
    expect(matchesToolPattern(bashRequest, 'Bash(rm *)')).toBe(true);
    expect(
      matchesToolPattern(
        {
          toolName: 'web-fetch',
          input: { url: 'https://claude.ai/docs/test' },
          sessionId: 'session-1',
        },
        'WebFetch(domain:claude.ai)',
      ),
    ).toBe(true);
  });

  test('derives scoped persistent patterns for generic tools', () => {
    expect(
      derivePersistentToolPattern({
        toolName: 'bash',
        input: { command: 'rm -rf dist' },
        sessionId: 'session-1',
      }),
    ).toBe('Bash(rm -rf dist)');

    expect(
      derivePersistentToolPattern({
        toolName: 'write',
        input: { path: 'src/index.ts', content: 'hello' },
        sessionId: 'session-1',
      }),
    ).toBe('Write(src/index.ts)');

    expect(
      derivePersistentToolPattern({
        toolName: 'git-status',
        input: {},
        sessionId: 'session-1',
      }),
    ).toBe('GitStatus');

    expect(
      derivePersistentToolPattern({
        toolName: 'web-fetch',
        input: { url: 'https://support.claude.com/hc/en-us' },
        sessionId: 'session-1',
      }),
    ).toBe('WebFetch(domain:support.claude.com)');
  });

  test('default mode allows safe defaults, denies blocked patterns, and prompts otherwise', async () => {
    const cwd = makeTempDir('iriscode-permissions-project-');
    const home = makeTempDir('iriscode-permissions-home-');

    writeFile(
      join(cwd, PROJECT_STATE_DIR, PROJECT_SETTINGS_FILE),
      JSON.stringify({
        permissions: {
          deny: ['Bash(rm *)'],
        },
      }, null, 2),
    );
    writeFile(
      join(home, '.iris', 'config.toml'),
      'allowed_tools = ["bash:echo"]\n',
    );

    await withEnv({ HOME: home }, async () => {
      const engine = new PermissionEngine('default', cwd);

      await expect(engine.check({ toolName: 'read', input: { path: 'README.md' }, sessionId: 's1' })).resolves.toMatchObject({
        decision: 'allow',
      });
      await expect(engine.check({ toolName: 'bash', input: { command: 'echo ok' }, sessionId: 's1' })).resolves.toMatchObject({
        decision: 'allow',
      });
      await expect(engine.check({ toolName: 'bash', input: { command: 'rm -rf dist' }, sessionId: 's1' })).resolves.toMatchObject({
        decision: 'deny',
      });
      await expect(engine.check({ toolName: 'write', input: { path: 'a.ts', content: 'x' }, sessionId: 's1' })).resolves.toMatchObject({
        decision: 'prompt',
      });
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('acceptEdits mode auto-approves write and edit', async () => {
    const cwd = makeTempDir('iriscode-permissions-accept-');
    const home = makeTempDir('iriscode-permissions-home-');

    await withEnv({ HOME: home }, async () => {
      const engine = new PermissionEngine('acceptEdits', cwd);

      await expect(engine.check({ toolName: 'write', input: { path: 'x.ts', content: '1' }, sessionId: 's1' })).resolves.toMatchObject({
        decision: 'allow',
      });
      await expect(engine.check({ toolName: 'edit', input: { path: 'x.ts', oldText: '1', newText: '2' }, sessionId: 's1' })).resolves.toMatchObject({
        decision: 'allow',
      });
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('runtime allow and block rules update the current session only', async () => {
    const cwd = makeTempDir('iriscode-permissions-runtime-');
    const home = makeTempDir('iriscode-permissions-home-');

    await withEnv({ HOME: home }, async () => {
      const engine = new PermissionEngine('default', cwd);
      const bashRequest = { toolName: 'bash', input: { command: 'echo ok' }, sessionId: 's1' };

      await expect(engine.check(bashRequest)).resolves.toMatchObject({ decision: 'prompt' });

      engine.addAllowed('bash', 'user');
      await expect(engine.check(bashRequest)).resolves.toMatchObject({ decision: 'allow' });

      engine.addBlocked('bash:echo', 'user');
      await expect(engine.check(bashRequest)).resolves.toMatchObject({ decision: 'deny' });
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('project-tier allow and block rules persist to .iris/settings.local.json', async () => {
    const cwd = makeTempDir('iriscode-permissions-project-persist-');
    const home = makeTempDir('iriscode-permissions-home-');

    await withEnv({ HOME: home }, async () => {
      const engine = new PermissionEngine('default', cwd);
      engine.addAllowed('Write(src/index.ts)', 'project');
      engine.addBlocked('Bash(rm *)', 'project');

      const settings = JSON.parse(
        readFileSync(join(cwd, PROJECT_STATE_DIR, PROJECT_SETTINGS_FILE), 'utf-8'),
      ) as { permissions?: { allow?: string[]; deny?: string[] } };

      expect(settings.permissions?.allow).toContain('Write(src/index.ts)');
      expect(settings.permissions?.deny).toContain('Bash(rm *)');
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('resolveRules merges project, user, and global tiers in precedence order', async () => {
    const cwd = makeTempDir('iriscode-permissions-rules-');
    const home = makeTempDir('iriscode-permissions-home-');

    writeFile(
      join(cwd, PROJECT_STATE_DIR, PROJECT_SETTINGS_FILE),
      JSON.stringify({
        permissions: {
          allow: ['Write(src/index.ts)'],
          deny: ['GitCommit'],
        },
      }, null, 2),
    );
    writeFile(
      join(home, '.iris', 'config.toml'),
      [
        'allowed_tools = ["bash:echo"]',
        'disallowed_tools = ["bash:rm"]',
      ].join('\n'),
    );

    await withEnv({ HOME: home }, async () => {
      const rules = resolveRules(cwd);
      expect(rules[0]).toMatchObject({ pattern: 'GitCommit', tier: 'project', decision: 'deny' });
      expect(rules.some((rule) => rule.pattern === 'bash:echo' && rule.tier === 'user')).toBe(true);
      expect(rules.some((rule) => rule.pattern === 'read' && rule.tier === 'global')).toBe(true);
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });
});
