import { cp, mkdir, readFile, rm } from 'fs/promises';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join, resolve } from 'path';
import { z } from 'zod';
import { loadPlugins } from './loader.ts';
import type { MarketplaceIndex, Plugin } from './types.ts';

const MarketplaceIndexSchema = z.object({
  name: z.string().min(1),
  plugins: z.array(z.object({
    name: z.string().min(1),
    source: z.string().min(1),
    description: z.string().min(1),
    version: z.string().min(1),
  }).strict()),
}).strict();

export async function installPlugin(source: string, targetDir: string): Promise<Plugin> {
  const absoluteTargetDir = resolve(targetDir);
  await mkdir(absoluteTargetDir, { recursive: true });

  const destination = resolve(absoluteTargetDir, inferPluginDirectoryName(source));
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(source)) {
    const clone = Bun.spawn(['git', 'clone', '--depth', '1', source, destination], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await clone.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(clone.stderr).text();
      throw new Error(stderr.trim() || `git clone failed with code ${exitCode}`);
    }
  } else {
    await cp(resolve(source), destination, { recursive: true });
  }

  const loaded = await loadPlugins(resolve(absoluteTargetDir, '..', '..'));
  const plugin = loaded.plugins.find((entry) => resolve(entry.rootDir) === destination);
  if (!plugin) {
    const manifestPath = resolve(destination, '.iris-plugin', 'plugin.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`Plugin installed to ${destination} but failed to load`);
    }
    return {
      manifest: JSON.parse(readFileSync(manifestPath, 'utf-8')) as Plugin['manifest'],
      components: {
        commands: [],
        agents: [],
        skills: [],
        hooks: null,
        mcpConfig: null,
      },
      rootDir: destination,
      status: 'loaded',
    };
  }

  return plugin;
}

export async function fetchMarketplace(marketplaceUrl: string): Promise<MarketplaceIndex> {
  const raw = /^https?:\/\//.test(marketplaceUrl)
    ? await fetchRemoteText(marketplaceUrl)
    : await readFile(resolve(marketplaceUrl), 'utf-8');

  const parsed = JSON.parse(raw) as unknown;
  const validation = MarketplaceIndexSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(validation.error.issues.map((issue) => issue.message).join(', '));
  }
  return validation.data;
}

export async function installFromMarketplace(
  pluginName: string,
  marketplace: MarketplaceIndex,
  targetDir: string,
): Promise<Plugin> {
  const entry = marketplace.plugins.find((plugin) => plugin.name === pluginName);
  if (!entry) {
    throw new Error(`Plugin "${pluginName}" was not found in marketplace "${marketplace.name}"`);
  }
  return installPlugin(entry.source, targetDir);
}

export async function uninstallPlugin(pluginName: string, targetDir: string): Promise<void> {
  const absoluteTargetDir = resolve(targetDir);
  const installed = listInstalledPlugins(absoluteTargetDir);
  const plugin = installed.find((entry) => entry.manifest.name === pluginName);
  if (!plugin) {
    throw new Error(`Plugin "${pluginName}" is not installed in ${absoluteTargetDir}`);
  }

  await rm(plugin.rootDir, { recursive: true, force: true });
}

export function listInstalledPlugins(targetDir: string): Plugin[] {
  const absoluteTargetDir = resolve(targetDir);
  if (!existsSync(absoluteTargetDir)) {
    return [];
  }

  return readdirSync(absoluteTargetDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(absoluteTargetDir, entry.name))
    .flatMap((rootDir) => {
      try {
        const manifestPath = resolve(rootDir, '.iris-plugin', 'plugin.json');
        if (!existsSync(manifestPath)) {
          return [];
        }
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Plugin['manifest'];
        return [{
          manifest,
          components: {
            commands: [],
            agents: [],
            skills: [],
            hooks: null,
            mcpConfig: null,
          },
          rootDir,
          status: 'loaded' as const,
        }];
      } catch {
        return [];
      }
    });
}

async function fetchRemoteText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch marketplace from ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function inferPluginDirectoryName(source: string): string {
  const trimmed = source.replace(/\/+$/, '');
  const base = basename(trimmed);
  return base.endsWith('.git') ? base.slice(0, -4) : base;
}
