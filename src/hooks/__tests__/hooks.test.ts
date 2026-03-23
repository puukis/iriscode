import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { cleanupDir, makeTempDir, writeFile } from '../../shared/test-helpers.ts';
import { HookRegistry } from '../registry.ts';
import { runPostHooks, runPreHooks } from '../runner.ts';

describe('hooks', () => {
  test('runPreHooks can modify input and plugin hooks receive IRIS_PLUGIN_ROOT', async () => {
    const cwd = makeTempDir('iriscode-hooks-project-');
    const pluginRoot = join(cwd, '.iris', 'plugins', 'demo-plugin');
    const scriptBaseDir = join(pluginRoot, 'hooks', 'scripts');
    writeFile(join(scriptBaseDir, 'modify.sh'), [
      '#!/bin/sh',
      `if [ "$IRIS_PLUGIN_ROOT" != "${pluginRoot}" ]; then exit 1; fi`,
      'printf \'{"action":"modify","modifiedInput":{"command":"echo hooked"}}\'',
    ].join('\n'));

    const registry = new HookRegistry();
    registry.register({
      name: 'modify-bash',
      event: 'tool:*',
      timing: 'pre',
      command: 'sh ./modify.sh',
    }, scriptBaseDir);

    const result = await runPreHooks('tool:bash', {
      event: 'tool:bash',
      timing: 'pre',
      toolName: 'bash',
      input: { command: 'echo original' },
      sessionId: 'session',
    }, registry);

    expect(result.action).toBe('continue');
    expect(result.modifiedInput).toEqual({ command: 'echo hooked' });

    cleanupDir(cwd);
  });

  test('runPostHooks can modify tool output', async () => {
    const cwd = makeTempDir('iriscode-hooks-post-');
    const scriptBaseDir = join(cwd, '.iris', 'hooks', 'scripts');
    writeFile(join(scriptBaseDir, 'rewrite.sh'), [
      '#!/bin/sh',
      'printf \'{"action":"modify","output":"rewritten by hook"}\'',
    ].join('\n'));

    const registry = new HookRegistry();
    registry.register({
      name: 'rewrite-result',
      event: 'tool:bash',
      timing: 'post',
      command: 'sh ./rewrite.sh',
    }, scriptBaseDir);

    const result = await runPostHooks('tool:bash', {
      event: 'tool:bash',
      timing: 'post',
      toolName: 'bash',
      input: { command: 'echo hi' },
      result: { content: 'original' },
      sessionId: 'session',
    }, registry);

    expect(result.content).toBe('rewritten by hook');

    cleanupDir(cwd);
  });
});
