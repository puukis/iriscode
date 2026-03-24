#!/usr/bin/env bun
import React from 'react';
import { existsSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { loadConfig } from '../config/loader.ts';
import { startConfigWatcher } from '../config/watcher.ts';
import { logger } from '../shared/logger.ts';
import { ensureDirectory } from '../config/utils.ts';
import { runConfigCommand } from './commands/config.ts';
import { runCostCommand } from './commands/cost.ts';
import { runModelsCommand } from './commands/models.ts';
import { runRunCommand } from './commands/run.ts';
import type { PermissionMode } from '../permissions/types.ts';
import { App, renderApp } from '../ui/app.tsx';
import { loadGlobalConfig } from '../config/global.ts';
import { loadProjectConfig } from '../config/project.ts';
import type { LoadedMemoryFile } from '../commands/types.ts';
import { buildSystemPrompt } from '../memory/retrieval.ts';
import { buildDefaultSystemPrompt } from '../agent/system-prompt.ts';
import { writeMemoryFromSession } from '../memory/memory-writer.ts';
import { CompactionManager } from '../memory/compaction.ts';
import type { Session } from '../agent/session.ts';
import type { ModelRegistry } from '../models/registry.ts';
import { buildExtensibilityStartupSummary, buildMcpStartupSummary } from './startup-summary.ts';
import { McpRegistry } from '../mcp/registry.ts';
import { McpServer } from '../mcp/server.ts';
import { HookRegistry } from '../hooks/registry.ts';
import { loadHooks } from '../hooks/loader.ts';
import { runEventHooks } from '../hooks/runner.ts';
import { loadPlugins, activatePlugin } from '../plugins/loader.ts';
import { loadSkills } from '../skills/loader.ts';
import { CommandRegistry } from '../commands/registry.ts';
import { BridgeServer } from '../bridge/server.ts';

const cwd = process.cwd();
const rawArgs = process.argv.slice(2);
const mcpMode = rawArgs.includes('--mcp');
const webMode = rawArgs.includes('--web');
const args: string[] = [];

let modelOverride: string | undefined;
let modeOverride: PermissionMode | undefined;
for (let index = 0; index < rawArgs.length; index += 1) {
  if ((rawArgs[index] === '--model' || rawArgs[index] === '-m') && rawArgs[index + 1]) {
    modelOverride = rawArgs[++index];
    continue;
  }
  if (rawArgs[index] === '--mode' && rawArgs[index + 1]) {
    const value = rawArgs[++index];
    if (value === 'default' || value === 'acceptEdits' || value === 'plan') {
      modeOverride = value;
    }
    continue;
  }
  if (rawArgs[index] === '--web') {
    continue;
  }
  args.push(rawArgs[index]);
}
const subcommand = args[0];

const initialConfig = await loadConfig(cwd);
logger.setLevel(initialConfig.log_level as Parameters<typeof logger.setLevel>[0]);

if (mcpMode) {
  const server = new McpServer();
  await server.start();
  process.exit(0);
}

if (subcommand === 'models') {
  await runModelsCommand();
  process.exit(0);
}

if (subcommand === 'cost') {
  runCostCommand();
  process.exit(0);
}

if (subcommand === 'config') {
  await runConfigCommand(cwd, args.slice(1));
  process.exit(0);
}

if (subcommand === 'run') {
  await runRunCommand(args.slice(1), { modelOverride, modeOverride });
  process.exit(0);
}

const initialMemoryFiles = await loadContextFilesForSession(cwd);
await ensureExtensibilityReadmes();
const hookRegistry = new HookRegistry();
const [hookLoad, pluginResult, skillResult] = await Promise.all([
  loadHooks(cwd, hookRegistry),
  loadPlugins(cwd),
  loadSkills(cwd),
]);
const mcpRegistry = new McpRegistry(initialConfig.mcp_servers);
const bootstrapRegistry = new CommandRegistry();
for (const plugin of pluginResult.plugins) {
  await activatePlugin(plugin, bootstrapRegistry, skillResult, hookRegistry, mcpRegistry, cwd);
}
await mcpRegistry.initialize();
hookLoad.errors.forEach((error) => logger.warn(error));
pluginResult.errors.forEach((error) => logger.warn(`${error.path}: ${error.error}`));
skillResult.errors.forEach((error) => logger.warn(`${error.path}: ${error.error}`));
const mcpSummary = buildMcpStartupSummary(mcpRegistry.getServerStates());
if (mcpSummary) {
  process.stdout.write(`${mcpSummary}\n`);
}
const extensibilitySummary = buildExtensibilityStartupSummary(
  skillResult,
  pluginResult,
  hookRegistry,
  mcpRegistry.getServerStates().filter((state) => state.status === 'connected').length,
);
if (extensibilitySummary) {
  process.stdout.write(`${extensibilitySummary}\n`);
}
const bridgeServer = webMode
  ? new BridgeServer(Number.parseInt(process.env.IRIS_WEB_PORT ?? '7878', 10) || 7878)
  : undefined;
if (bridgeServer) {
  bridgeServer.start();
  process.stdout.write(`Web UI bridge available at ws://localhost:${process.env.IRIS_WEB_PORT ?? '7878'}\n`);
}
const stopWatching = startConfigWatcher(cwd);
process.on('exit', () => {
  stopWatching();
  void mcpRegistry.disconnectAll();
  bridgeServer?.stop();
});

// Build initial system prompt and check memory budget
const basePrompt = buildDefaultSystemPrompt();
const { budget } = await buildSystemPrompt(cwd, basePrompt);

if (budget.status === 'exceeded') {
  process.stderr.write(
    `Warning: memory budget exceeded (${budget.totalTokens.toLocaleString()} / 10,000 tokens). ` +
    `Trim the largest files: ${budget.largestFiles.map((f) => f.path).join(', ')}\n`,
  );
}

// Refs for exit handler
const sessionRef: { current: Session | null } = { current: null };
let compactionManager: CompactionManager | null = null;
let modelRegistryForExit: ModelRegistry | null = null;

const app = renderApp(
  <App
    cwd={cwd}
    initialConfig={initialConfig}
    initialMemoryFiles={initialMemoryFiles}
    modelOverride={modelOverride}
    modeOverride={modeOverride}
    mcpRegistry={mcpRegistry}
    skillResult={skillResult}
    hookRegistry={hookRegistry}
    pluginResult={pluginResult}
    bridgeServer={bridgeServer}
    onReady={(ref) => {
      Object.assign(sessionRef, ref);
    }}
    onCompactionManagerReady={(cm, registry) => {
      compactionManager = cm;
      modelRegistryForExit = registry;
    }}
  />,
);

const shutdown = async () => {
  stopWatching();
  compactionManager?.stop();
  await mcpRegistry.disconnectAll();
  bridgeServer?.stop();

  const session = sessionRef.current;
  const registry = modelRegistryForExit;
  if (session) {
    await runEventHooks('session:end', {
      event: 'session:end',
      timing: 'post',
      sessionId: session.id,
    }, hookRegistry);
  }

  if (session) {
    try {
      await session.save();
    } catch {
      // Non-fatal
    }
    if (registry) {
      void writeMemoryFromSession(session, registry);
    }
  }

  app.unmount();
  process.exit(0);
};

process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});

async function loadContextFilesForSession(cwd: string): Promise<LoadedMemoryFile[]> {
  const [globalInput, projectInput] = await Promise.all([
    loadGlobalConfig(),
    loadProjectConfig(cwd),
  ]);

  return [...globalInput.contextFiles, ...projectInput.contextFiles].map((file) => ({
    path: file.path,
    lineCount: file.lineCount,
    tokenCount: file.tokenCount,
    preview: file.text.split('\n').slice(0, 3).join('\n'),
  }));
}

async function ensureExtensibilityReadmes(): Promise<void> {
  const baseDir = resolve(process.env.HOME ?? homedir(), '.iris');
  const targets = [
    {
      path: join(baseDir, 'skills', 'README.md'),
      content: '# IrisCode Skills\n\nPlace global skills here. Each skill lives in its own folder with a `SKILL.md` file.\n',
    },
    {
      path: join(baseDir, 'plugins', 'README.md'),
      content: '# IrisCode Plugins\n\nPlace installed global plugins here. Each plugin needs `.iris-plugin/plugin.json`.\n',
    },
    {
      path: join(baseDir, 'hooks', 'README.md'),
      content: '# IrisCode Hooks\n\nGlobal hooks live here. Define them in `hooks.json` and put executable scripts in `scripts/`.\n',
    },
  ];

  for (const target of targets) {
    const directory = ensureDirectory(resolve(target.path, '..'));
    if (!existsSync(target.path)) {
      writeFileSync(target.path, target.content, 'utf-8');
    }
  }
}
