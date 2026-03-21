import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { BuiltinHandler, CommandEntry } from '../types.ts';

export const MEMORY_COMMAND: CommandEntry = {
  name: 'memory',
  description: 'Inspect the loaded project memory budget and files.',
  category: 'builtin',
};

export const handleMemory: BuiltinHandler = async (ctx) => {
  try {
    const totalTokens = ctx.session.memoryFiles.reduce((sum, file) => sum + file.tokenCount, 0);
    const lines = [
      renderBudgetBar(totalTokens, ctx.session.memoryMaxTokens),
      '',
      ...ctx.session.memoryFiles.map((file) =>
        `${file.path} | ${file.lineCount} lines | ${file.tokenCount.toLocaleString()} tokens`,
      ),
    ];

    if (totalTokens > 8000) {
      const largest = [...ctx.session.memoryFiles]
        .sort((left, right) => right.tokenCount - left.tokenCount)
        .slice(0, 3)
        .map((file) => file.path)
        .join(', ');
      lines.push('', `Warning: memory usage is high. Largest files: ${largest}`);
    }
    if (totalTokens > 10000) {
      lines.push('Error: memory budget exceeded.');
    }

    const memoryMdPath = join(ctx.cwd, 'MEMORY.md');
    if (existsSync(memoryMdPath)) {
      const preview = readFileSync(memoryMdPath, 'utf-8').split('\n').slice(0, 20).join('\n');
      lines.push('', 'MEMORY.md preview:', preview);
    }

    ctx.session.writeInfo(lines.join('\n').trim());
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

function renderBudgetBar(used: number, max: number): string {
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const filled = Math.round(ratio * 10);
  return `[memory: ${used.toLocaleString()} / ${max.toLocaleString()} tokens ${'█'.repeat(filled)}${'░'.repeat(10 - filled)}]`;
}
