import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { basename, join, resolve } from 'path';
import { z } from 'zod';
import { createCommandEntryFromFile, readMarkdownCommandFile } from '../commands/custom/shared.ts';
import type { CommandRegistry } from '../commands/registry.ts';
import { registerHooksFromFile } from '../hooks/loader.ts';
import type { HookRegistry } from '../hooks/registry.ts';
import { McpServerSchema } from '../config/schema.ts';
import type { McpRegistry } from '../mcp/registry.ts';
import { logger } from '../shared/logger.ts';
import { loadSkillDirectory, refreshSkillLoadResult } from '../skills/loader.ts';
import type { SkillLoadResult } from '../skills/types.ts';
import type { Plugin, PluginComponents, PluginLoadResult, PluginManifest } from './types.ts';

const PluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
  description: z.string().min(1),
  author: z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    url: z.string().url().optional(),
  }).strict().optional(),
  license: z.string().min(1).optional(),
  homepage: z.string().url().optional(),
  keywords: z.array(z.string().min(1)).optional(),
}).strict();

export async function loadPlugins(cwd: string): Promise<PluginLoadResult> {
  const errors: PluginLoadResult['errors'] = [];
  const byName = new Map<string, Plugin>();
  const roots = [
    join(process.env.HOME ?? homedir(), '.iris', 'plugins'),
    resolve(cwd, '.iris', 'plugins'),
  ];

  for (const root of roots) {
    for (const plugin of loadPluginsFromDirectory(root, errors)) {
      byName.set(plugin.manifest.name, plugin);
    }
  }

  return {
    plugins: Array.from(byName.values()).sort((left, right) => left.manifest.name.localeCompare(right.manifest.name)),
    errors,
  };
}

export async function activatePlugin(
  plugin: Plugin,
  registry: CommandRegistry,
  skillResult: SkillLoadResult,
  hookRegistry: HookRegistry,
  mcpRegistry: McpRegistry,
  cwd: string,
): Promise<void> {
  for (const commandPath of plugin.components.commands) {
    const parsed = await readMarkdownCommandFile(commandPath);
    const name = basename(commandPath).replace(/\.md$/i, '');
    registry.registerCustom(
      createCommandEntryFromFile(
        name,
        commandPath,
        'custom',
        parsed,
        `Plugin command from ${plugin.manifest.name}/${basename(commandPath)}`,
      ),
    );
  }

  for (const skillDir of plugin.components.skills) {
    const skill = await loadSkillDirectory(skillDir, plugin.manifest.name);
    const index = skillResult.skills.findIndex((entry) => entry.frontmatter.name === skill.frontmatter.name);
    if (index >= 0) {
      skillResult.skills[index] = skill;
    } else {
      skillResult.skills.push(skill);
    }
  }
  await refreshSkillLoadResult(cwd, skillResult);

  if (plugin.components.hooks) {
    const hookLoad = registerHooksFromFile(plugin.components.hooks, hookRegistry);
    hookLoad.errors.forEach((error) => logger.warn(error));
  }

  if (plugin.components.mcpConfig) {
    const servers = readPluginMcpConfig(plugin.components.mcpConfig);
    for (const server of servers) {
      if (mcpRegistry.getServer(server.name)) {
        continue;
      }
      await mcpRegistry.addServer(server);
    }
  }
}

export function readPluginMcpConfig(filePath: string) {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
  const candidates = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null
      ? ((raw as Record<string, unknown>).mcp_servers
        ?? (raw as Record<string, unknown>).servers
        ?? [])
      : [];

  if (!Array.isArray(candidates)) {
    throw new Error(`Invalid MCP config in ${filePath}`);
  }

  return candidates.map((candidate, index) => {
    const parsed = McpServerSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(
        `Invalid MCP server ${index + 1} in ${filePath}: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`,
      );
    }
    return parsed.data;
  });
}

function loadPluginsFromDirectory(
  rootDir: string,
  errors: PluginLoadResult['errors'],
): Plugin[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const entries = readdirSync(rootDir, { withFileTypes: true });
  const plugins: Plugin[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pluginRoot = resolve(rootDir, entry.name);
    try {
      plugins.push(loadPlugin(pluginRoot));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      plugins.push({
        manifest: {
          name: entry.name,
          version: '0.0.0',
          description: 'Failed to load plugin',
        },
        components: {
          commands: [],
          agents: [],
          skills: [],
          hooks: null,
          mcpConfig: null,
        },
        rootDir: pluginRoot,
        status: 'error',
        error: message,
      });
      errors.push({ path: pluginRoot, error: message });
    }
  }

  return plugins.filter((plugin) => plugin.status === 'loaded');
}

function loadPlugin(rootDir: string): Plugin {
  const manifestPath = resolve(rootDir, '.iris-plugin', 'plugin.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing plugin manifest at ${manifestPath}`);
  }

  const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
  const manifestValidation = PluginManifestSchema.safeParse(manifestRaw);
  if (!manifestValidation.success) {
    throw new Error(manifestValidation.error.issues.map((issue) => issue.message).join(', '));
  }

  return {
    manifest: manifestValidation.data as PluginManifest,
    components: discoverPluginComponents(rootDir),
    rootDir: resolve(rootDir),
    status: 'loaded',
  };
}

function discoverPluginComponents(rootDir: string): PluginComponents {
  return {
    commands: discoverMarkdownFiles(resolve(rootDir, 'commands')),
    agents: discoverMarkdownFiles(resolve(rootDir, 'agents')),
    skills: discoverSkillFolders(resolve(rootDir, 'skills')),
    hooks: existsSync(resolve(rootDir, 'hooks', 'hooks.json'))
      ? resolve(rootDir, 'hooks', 'hooks.json')
      : null,
    mcpConfig: existsSync(resolve(rootDir, '.mcp.json'))
      ? resolve(rootDir, '.mcp.json')
      : null,
  };
}

function discoverMarkdownFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => resolve(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function discoverSkillFolders(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(directory, entry.name, 'SKILL.md')))
    .map((entry) => resolve(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}
