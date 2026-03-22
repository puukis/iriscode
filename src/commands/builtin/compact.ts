import type { BuiltinHandler, CommandEntry } from '../types.ts';
import { compactSession } from '../../memory/compact.ts';

export const COMPACT_COMMAND: CommandEntry = {
  name: 'compact',
  description: 'Compact the current conversation into a reusable summary.',
  category: 'builtin',
  argumentHint: '[instructions]',
};

export const handleCompact: BuiltinHandler = async (ctx) => {
  try {
    const extraInstructions = ctx.args.join(' ').trim();

    if (!ctx.compactionManager || !ctx.modelRegistry) {
      // Fallback: old behaviour when not wired yet
      ctx.session.writeInfo('Compacting (basic mode — memory system not initialized)…');
      ctx.session.compact('Session compacted.');
      return { type: 'handled' };
    }

    ctx.session.writeInfo('Compacting…');
    const result = await compactSession(
      ctx.session,
      ctx.compactionManager,
      ctx.modelRegistry,
      extraInstructions || undefined,
    );

    ctx.session.writeInfo(
      `Compacted. Reduced from ${result.tokensBefore.toLocaleString()} to ${result.tokensAfter.toLocaleString()} tokens. Summary source: ${result.source}.`,
    );
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};
