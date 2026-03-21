import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { Session } from '../session.ts';
import { PermissionEngine } from '../../permissions/engine.ts';
import { defaults, type ResolvedConfig } from '../../config/schema.ts';
import { cleanupDir, makeTempDir, withEnv, writeFile } from '../../shared/test-helpers.ts';

function makeResolvedConfig(): ResolvedConfig {
  return {
    model: defaults.model,
    default_model: defaults.default_model,
    providers: structuredClone(defaults.providers),
    permissions: structuredClone(defaults.permissions),
    memory: structuredClone(defaults.memory),
    mcp_servers: [],
    context_text: '',
    log_level: defaults.log_level,
  };
}

describe('session', () => {
  test('saves, loads, and lists sessions from .iris/sessions', async () => {
    const cwd = makeTempDir('iriscode-session-project-');
    const home = makeTempDir('iriscode-session-home-');
    writeFile(join(cwd, 'IRIS.md'), '# Test project\n');

    await withEnv({ HOME: home }, async () => {
      const config = makeResolvedConfig();
      const session = new Session({
        cwd,
        config,
        permissionEngine: new PermissionEngine('default', cwd),
        autosave: false,
      });
      session.messages = [{ role: 'user', content: 'hello' }];
      session.displayMessages = [
        { role: 'system', text: 'IrisCode — test banner' },
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'world' },
      ];
      session.totalInputTokens = 12;
      session.totalOutputTokens = 8;

      await session.save();

      const loaded = await Session.load(session.id, cwd);
      expect(loaded.id).toBe(session.id);
      expect(loaded.messages).toEqual(session.messages);
      expect(loaded.displayMessages.at(-1)?.text).toBe('world');

      const sessions = await Session.listSessions(cwd);
      expect(sessions.some((entry) => entry.id === session.id)).toBe(true);
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });
});
