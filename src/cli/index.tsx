#!/usr/bin/env bun
import React from 'react';
import { loadConfig } from '../config/loader.ts';
import { startConfigWatcher } from '../config/watcher.ts';
import { logger } from '../shared/logger.ts';
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

const cwd = process.cwd();
const args = process.argv.slice(2);
const subcommand = args[0];

let modelOverride: string | undefined;
let modeOverride: PermissionMode | undefined;
for (let index = 0; index < args.length; index += 1) {
  if ((args[index] === '--model' || args[index] === '-m') && args[index + 1]) {
    modelOverride = args[++index];
    continue;
  }
  if (args[index] === '--mode' && args[index + 1]) {
    const value = args[++index];
    if (value === 'default' || value === 'acceptEdits' || value === 'plan') {
      modeOverride = value;
    }
  }
}

const initialConfig = await loadConfig(cwd);
logger.setLevel(initialConfig.log_level as Parameters<typeof logger.setLevel>[0]);

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
const stopWatching = startConfigWatcher(cwd);
process.on('exit', stopWatching);

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

  const session = sessionRef.current;
  const registry = modelRegistryForExit;

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
