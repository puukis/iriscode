import type { BuiltinHandler, CommandEntry } from '../types.ts';
import { loadSessionSummary, saveSessionSummary } from '../session-store.ts';

export const COMPACT_COMMAND: CommandEntry = {
  name: 'compact',
  description: 'Compact the current conversation into a reusable summary.',
  category: 'builtin',
  argumentHint: '[instructions]',
};

export const handleCompact: BuiltinHandler = async (ctx) => {
  try {
    const extraInstructions = ctx.args.join(' ').trim();
    let summary = loadSessionSummary(ctx.cwd, ctx.session.id);
    if (!summary) {
      summary = summarizeMessages(ctx.session.displayMessages, extraInstructions);
      saveSessionSummary(ctx.cwd, ctx.session.id, summary);
    }

    await ctx.session.refreshContext();
    ctx.session.compact(summary);
    ctx.session.writeInfo('Compacted. Context window refreshed.');
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

function summarizeMessages(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; text: string }>,
  extraInstructions: string,
): string {
  const lines = messages
    .filter((message) => message.role !== 'system' || !message.text.startsWith('IrisCode — '))
    .slice(-20)
    .map((message) => `${message.role}: ${message.text}`);

  const suffix = extraInstructions ? `\nFocus: ${extraInstructions}` : '';
  return [`Conversation summary`, '', ...lines, suffix].filter(Boolean).join('\n');
}
