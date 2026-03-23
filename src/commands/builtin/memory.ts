import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { BuiltinHandler, CommandEntry, MemoryMenuAction } from '../types.ts';
import { loadIrisHierarchy } from '../../memory/loader.ts';
import { checkBudget, MEMORY_TOKEN_LIMIT } from '../../memory/budget.ts';
import { loadMemory, clearMemory } from '../../memory/store.ts';
import { getGlobalContextPath } from '../../config/global.ts';

export const MEMORY_COMMAND: CommandEntry = {
  name: 'memory',
  description: 'Inspect the loaded project memory budget and files.',
  category: 'builtin',
};

export const handleMemory: BuiltinHandler = async (ctx) => {
  try {
    const [hierarchy, memory] = await Promise.all([
      loadIrisHierarchy(ctx.cwd),
      loadMemory(ctx.cwd),
    ]);

    const budget = checkBudget(hierarchy, memory.totalLines);
    const lines: string[] = [];

    // Budget bar
    lines.push(renderBudgetBar(budget.totalTokens, MEMORY_TOKEN_LIMIT));
    lines.push('');

    // IRIS.md sources table
    if (hierarchy.sources.length > 0) {
      lines.push('IRIS.md files loaded:');
      for (const source of hierarchy.sources) {
        lines.push(`  ${source.path} | ${source.lines} lines | ${source.tokens.toLocaleString()} tokens`);
      }
    } else {
      lines.push('No IRIS.md files loaded.');
    }

    // Warnings
    if (budget.status === 'warning') {
      const largest = budget.largestFiles.map((f) => f.path).join(', ');
      lines.push('', `Warning: memory usage is high. Largest files: ${largest}`);
    }
    if (budget.status === 'exceeded') {
      const largest = budget.largestFiles.map((f) => f.path).join(', ');
      lines.push('', `Error: memory budget exceeded. Trim these files: ${largest}`);
    }

    // MEMORY.md preview (first 20 lines)
    if (memory.combined) {
      const preview = memory.combined.split('\n').slice(0, 20).join('\n');
      lines.push('', 'MEMORY.md preview:', preview);
    }

    ctx.session.writeInfo(lines.join('\n').trim());

    // Sub-action menu
    const action = await ctx.session.openMemoryMenu();
    if (action) {
      await executeMemoryAction(ctx.cwd, action, ctx.session);
    }

    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

async function executeMemoryAction(
  cwd: string,
  action: MemoryMenuAction,
  session: import('../types.ts').SessionState,
): Promise<void> {
  switch (action) {
    case 'clear-project':
      await clearMemory(cwd, 'project');
      session.writeInfo('Project memory cleared.');
      break;
    case 'clear-global':
      await clearMemory(cwd, 'global');
      session.writeInfo('Global memory cleared.');
      break;
    case 'edit-project':
      await openInTerminalEditor(resolve(cwd, 'IRIS.md'));
      session.resumeUi();
      await session.refreshContext();
      break;
    case 'edit-global':
      await openInTerminalEditor(getGlobalContextPath());
      session.resumeUi();
      await session.refreshContext();
      break;
  }
}

async function openInTerminalEditor(filePath: string): Promise<void> {
  ensureTextFileExists(filePath);

  const editor = resolveTerminalEditor();
  const stdin = process.stdin as NodeJS.ReadStream & {
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  const wasRaw = Boolean(stdin.isRaw);
  const interactiveTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (interactiveTty && wasRaw) {
    stdin.setRawMode?.(false);
  }

  if (interactiveTty) {
    process.stdout.write('\x1b[?2004l');
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
  }

  try {
    const result = Bun.spawnSync([...editor, filePath], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });

    if (result.exitCode !== 0) {
      throw new Error(`Editor exited with code ${result.exitCode}`);
    }
  } finally {
    if (interactiveTty) {
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      process.stdout.write('\x1b[?2004h');
    }
    if (interactiveTty && wasRaw) {
      stdin.setRawMode?.(true);
    }
  }
}

function resolveTerminalEditor(): string[] {
  const candidates = [
    process.env.EDITOR?.trim(),
    'vim',
    'nano',
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  for (const candidate of candidates) {
    const [command, ...args] = candidate.split(/\s+/).filter(Boolean);
    if (command && Bun.which(command)) {
      return [command, ...args];
    }
  }

  throw new Error('No terminal editor found. Install vim or nano, or set $EDITOR.');
}

function ensureTextFileExists(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '', 'utf-8');
  }
}

function renderBudgetBar(used: number, max: number): string {
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const filled = Math.round(ratio * 10);
  return `[memory: ${used.toLocaleString()} / ${max.toLocaleString()} tokens ${'█'.repeat(filled)}${'░'.repeat(10 - filled)}]`;
}
