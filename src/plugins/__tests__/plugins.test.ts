import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { CommandRegistry } from '../../commands/registry.ts';
import { HookRegistry } from '../../hooks/registry.ts';
import { McpRegistry } from '../../mcp/registry.ts';
import { cleanupDir, makeTempDir, withEnv, writeFile } from '../../shared/test-helpers.ts';
import { loadSkills } from '../../skills/loader.ts';
import { activatePlugin, loadPlugins } from '../loader.ts';

describe('plugins', () => {
  test('loadPlugins discovers components and activatePlugin registers commands and skills', async () => {
    const cwd = makeTempDir('iriscode-plugins-project-');
    const home = makeTempDir('iriscode-plugins-home-');

    writeFile(join(cwd, '.iris', 'plugins', 'docs', '.iris-plugin', 'plugin.json'), JSON.stringify({
      name: 'docs',
      version: '1.0.0',
      description: 'Documentation tools',
    }, null, 2));
    writeFile(join(cwd, '.iris', 'plugins', 'docs', 'commands', 'summarize.md'), [
      '---',
      'description: Summarize docs',
      '---',
      '',
      'Summarize the docs.',
    ].join('\n'));
    writeFile(join(cwd, '.iris', 'plugins', 'docs', 'skills', 'pdf', 'SKILL.md'), [
      '---',
      'name: pdf',
      'description: Analyze PDFs',
      '---',
      '',
      'Use pdftotext.',
    ].join('\n'));
    writeFile(join(cwd, '.iris', 'plugins', 'docs', 'hooks', 'hooks.json'), JSON.stringify({
      hooks: [
        {
          name: 'log-bash',
          event: 'tool:bash',
          timing: 'pre',
          command: 'sh ./noop.sh',
        },
      ],
    }, null, 2));
    writeFile(join(cwd, '.iris', 'plugins', 'docs', 'hooks', 'scripts', 'noop.sh'), '#!/bin/sh\nprintf \'{"action":"continue"}\'');

    await withEnv({ HOME: home }, async () => {
      const pluginResult = await loadPlugins(cwd);
      expect(pluginResult.plugins).toHaveLength(1);
      const plugin = pluginResult.plugins[0];
      expect(plugin.components.commands).toHaveLength(1);
      expect(plugin.components.skills).toHaveLength(1);
      expect(plugin.components.hooks).not.toBeNull();

      const registry = new CommandRegistry();
      const skillResult = await loadSkills(cwd);
      const hookRegistry = new HookRegistry();
      const mcpRegistry = new McpRegistry([]);
      await activatePlugin(plugin, registry, skillResult, hookRegistry, mcpRegistry, cwd);

      expect(registry.get('summarize')?.entry.description).toBe('Summarize docs');
      expect(skillResult.skills.some((skill) => skill.frontmatter.name === 'docs:pdf')).toBe(true);
      expect(hookRegistry.list()).toHaveLength(1);
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });
});
