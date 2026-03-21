import { resolve } from 'path';
import type { BuiltinHandler, CommandEntry } from '../types.ts';

export const DIFF_COMMAND: CommandEntry = {
  name: 'diff',
  description: 'Review accepted and rejected file diffs from the current session.',
  category: 'builtin',
  argumentHint: '[file]',
};

export const handleDiff: BuiltinHandler = async (ctx) => {
  try {
    const target = ctx.args[0]?.trim();
    const entries = target
      ? findDiffsForFile(ctx, target)
      : ctx.session.diffStore.list();

    if (entries.length === 0) {
      ctx.session.writeInfo(
        target
          ? `No diffs recorded for ${target}.`
          : `No diffs recorded yet. ${ctx.session.diffStore.summary()}`,
      );
      return { type: 'handled' };
    }

    if (!target) {
      const lines = [
        'Session diffs',
        '',
        ctx.session.diffStore.summary(),
        '',
        ...entries.map((entry) => {
          const timestamp = entry.timestamp.toLocaleTimeString();
          return `${entry.decision.padEnd(8)} ${entry.diff.filePath} (+${entry.diff.stats.added} -${entry.diff.stats.removed}) ${timestamp}`;
        }),
      ];
      ctx.session.writeInfo(lines.join('\n'));
      return { type: 'handled' };
    }

    for (const entry of entries) {
      await ctx.session.viewDiff(entry.diff, { readOnly: true });
    }

    ctx.session.writeInfo(`Displayed ${entries.length} recorded diff${entries.length === 1 ? '' : 's'} for ${target}.`);
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

function findDiffsForFile(ctx: Parameters<BuiltinHandler>[0], target: string) {
  const absoluteTarget = resolve(ctx.cwd, target);
  const directMatches = ctx.session.diffStore.getByFile(absoluteTarget);
  if (directMatches.length > 0) {
    return directMatches;
  }

  return ctx.session.diffStore
    .list()
    .filter((entry) => entry.diff.filePath.endsWith(target) || entry.diff.filePath === target);
}
