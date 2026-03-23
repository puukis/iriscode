import { basename, dirname, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { loadCustomCommands } from '../custom/loader.ts';
import { loadHooks } from '../../hooks/loader.ts';
import { loadPlugins, activatePlugin, readPluginMcpConfig } from '../../plugins/loader.ts';
import { fetchMarketplace, installFromMarketplace, installPlugin, uninstallPlugin } from '../../plugins/installer.ts';
import { loadSkills } from '../../skills/loader.ts';
import { registerSkillCommands } from '../skill-bridge.ts';
import type { Plugin } from '../../plugins/types.ts';
import type { BuiltinHandler, CommandEntry, PickerOption } from '../types.ts';

export const PLUGINS_COMMAND: CommandEntry = {
  name: 'plugins',
  description: 'Browse installed plugins, install new ones, and inspect marketplace entries.',
  category: 'builtin',
};

export const handlePlugins: BuiltinHandler = async (ctx) => {
  try {
    if (!ctx.pluginResult || !ctx.skillResult || !ctx.hookRegistry || !ctx.mcpRegistry || !ctx.registry) {
      ctx.session.writeInfo('Plugin management is unavailable in this session.');
      return { type: 'handled' };
    }

    ctx.session.writeInfo(renderPluginTable(ctx.pluginResult.plugins));
    const action = await ctx.session.openPicker([
      { label: 'Install plugin', value: 'install', description: 'Install from a GitHub URL or local path' },
      { label: 'Uninstall plugin', value: 'uninstall', description: 'Remove an installed plugin' },
      { label: 'Browse marketplace', value: 'marketplace', description: 'Fetch a marketplace index and install from it' },
      { label: 'Show plugin details', value: 'details', description: 'Inspect the manifest and packaged components' },
    ], 'Plugins');

    if (!action) {
      return { type: 'handled' };
    }

    if (action === 'install') {
      const source = (await ctx.session.ask('Plugin source (GitHub URL or local path):')).trim();
      if (!source) {
        ctx.session.writeInfo('Install cancelled.');
        return { type: 'handled' };
      }
      await installPlugin(source, resolve(ctx.cwd, '.iris', 'plugins'));
      await reloadPluginRuntime(ctx);
      ctx.session.writeInfo(`Installed plugin from ${source}`);
      return { type: 'handled' };
    }

    if (action === 'uninstall') {
      await removePlugin(ctx);
      return { type: 'handled' };
    }

    if (action === 'marketplace') {
      const marketplaceUrl = (await ctx.session.ask('Marketplace URL or local path:')).trim();
      if (!marketplaceUrl) {
        ctx.session.writeInfo('Marketplace browse cancelled.');
        return { type: 'handled' };
      }
      const marketplace = await fetchMarketplace(marketplaceUrl);
      const selected = await ctx.session.openPicker(
        marketplace.plugins.map((plugin) => ({
          label: `${plugin.name} (${plugin.version})`,
          value: plugin.name,
          description: plugin.description,
        })),
        marketplace.name,
      );
      if (!selected) {
        ctx.session.writeInfo('Marketplace install cancelled.');
        return { type: 'handled' };
      }
      await installFromMarketplace(selected, marketplace, resolve(ctx.cwd, '.iris', 'plugins'));
      await reloadPluginRuntime(ctx);
      ctx.session.writeInfo(`Installed marketplace plugin: ${selected}`);
      return { type: 'handled' };
    }

    if (action === 'details') {
      await showPluginDetails(ctx);
      return { type: 'handled' };
    }

    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

async function removePlugin(ctx: Parameters<BuiltinHandler>[0]): Promise<void> {
  const selected = await pickPlugin(ctx, 'Uninstall plugin');
  if (!selected || !ctx.pluginResult) {
    ctx.session.writeInfo('Uninstall cancelled.');
    return;
  }

  const confirmation = (await ctx.session.ask(`Uninstall plugin "${selected.manifest.name}"? [y/N]`)).trim().toLowerCase();
  if (!['y', 'yes'].includes(confirmation)) {
    ctx.session.writeInfo('Uninstall cancelled.');
    return;
  }

  await uninstallPlugin(selected.manifest.name, dirname(selected.rootDir));
  await reloadPluginRuntime(ctx);
  ctx.session.writeInfo(`Uninstalled plugin: ${selected.manifest.name}`);
}

async function showPluginDetails(ctx: Parameters<BuiltinHandler>[0]): Promise<void> {
  const selected = await pickPlugin(ctx, 'Show plugin details');
  if (!selected) {
    ctx.session.writeInfo('Show plugin details cancelled.');
    return;
  }

  const manifestPath = resolve(selected.rootDir, '.iris-plugin', 'plugin.json');
  const lines = [
    `Plugin: ${selected.manifest.name}`,
    `Version: ${selected.manifest.version}`,
    `Description: ${selected.manifest.description}`,
    `Root: ${selected.rootDir}`,
    '',
    `Commands: ${selected.components.commands.length}`,
    `Agents: ${selected.components.agents.length}`,
    `Skills: ${selected.components.skills.length}`,
    `Hooks: ${selected.components.hooks ? 1 : 0}`,
    `MCP config: ${selected.components.mcpConfig ? 'yes' : 'no'}`,
    '',
    readFileSync(manifestPath, 'utf-8'),
  ];

  const readmePath = resolve(selected.rootDir, 'README.md');
  if (existsSync(readmePath)) {
    lines.push('', 'README.md', '', readFileSync(readmePath, 'utf-8'));
  }

  ctx.session.writeInfo(lines.join('\n'));
}

async function pickPlugin(
  ctx: Parameters<BuiltinHandler>[0],
  title: string,
) {
  const options: PickerOption[] = (ctx.pluginResult?.plugins ?? []).map((plugin) => ({
    label: `${plugin.manifest.name} (${plugin.manifest.version})`,
    value: plugin.manifest.name,
    description: plugin.manifest.description,
  }));
  const selected = await ctx.session.openPicker(options, title);
  return ctx.pluginResult?.plugins.find((plugin) => plugin.manifest.name === selected);
}

async function reloadPluginRuntime(ctx: Parameters<BuiltinHandler>[0]): Promise<void> {
  if (!ctx.pluginResult || !ctx.skillResult || !ctx.hookRegistry || !ctx.mcpRegistry || !ctx.registry) {
    return;
  }

  const previousPlugins = [...ctx.pluginResult.plugins];
  for (const plugin of previousPlugins) {
    if (plugin.components.mcpConfig) {
      try {
        const servers = readPluginMcpConfig(plugin.components.mcpConfig);
        await Promise.all(servers.map((server) => ctx.mcpRegistry!.removeServer(server.name)));
      } catch {
        // Ignore malformed plugin configs during teardown.
      }
    }
  }

  ctx.hookRegistry.clear();
  await loadHooks(ctx.cwd, ctx.hookRegistry);

  Object.assign(ctx.pluginResult, await loadPlugins(ctx.cwd));
  Object.assign(ctx.skillResult, await loadSkills(ctx.cwd));

  ctx.registry.clearNonBuiltin();
  const customCommands = await loadCustomCommands(ctx.cwd);
  for (const entry of customCommands) {
    ctx.registry.registerCustom(entry);
  }
  for (const plugin of ctx.pluginResult.plugins) {
    await activatePlugin(plugin, ctx.registry, ctx.skillResult, ctx.hookRegistry, ctx.mcpRegistry, ctx.cwd);
  }
  registerSkillCommands(ctx.registry, ctx.skillResult);
}

function renderPluginTable(plugins: Plugin[]): string {
  if (plugins.length === 0) {
    return 'No plugins loaded.';
  }

  const rows = plugins.map((plugin) => ({
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    description: plugin.manifest.description,
    counts: `${plugin.components.commands.length} commands, ${plugin.components.skills.length} skills, ${plugin.components.hooks ? 1 : 0} hooks`,
  }));

  const widths = {
    name: Math.max(4, ...rows.map((row) => row.name.length)),
    version: Math.max(7, ...rows.map((row) => row.version.length)),
  };

  return [
    `${'name'.padEnd(widths.name)}  ${'version'.padEnd(widths.version)}  components  description`,
    ...rows.map((row) =>
      `${row.name.padEnd(widths.name)}  ${row.version.padEnd(widths.version)}  ${row.counts}  ${row.description}`,
    ),
  ].join('\n');
}
