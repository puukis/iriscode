import type { BuiltinHandler, CommandEntry } from '../types.ts';

export const STATUS_COMMAND: CommandEntry = {
  name: 'status',
  description: 'Show the current session, model, token, and memory status.',
  category: 'builtin',
};

export const handleStatus: BuiltinHandler = async (ctx) => {
  try {
    const costTotal = ctx.session.costTracker.total();
    const memoryTokens = ctx.session.memoryFiles.reduce((sum, file) => sum + file.tokenCount, 0);
    const ageMinutes = Math.max(1, Math.round((Date.now() - ctx.session.startedAt) / 60000));
    const text = [
      `model:    ${ctx.session.model}`,
      `mode:     ${ctx.engine.getMode()}`,
      `tokens:   ${ctx.session.totalInputTokens.toLocaleString()} in / ${ctx.session.totalOutputTokens.toLocaleString()} out`,
      `cost:     $${costTotal.costUsd.toFixed(6)}`,
      `memory:   ${memoryTokens.toLocaleString()} / ${ctx.session.memoryMaxTokens.toLocaleString()} tokens`,
      `session:  ${ctx.session.id.slice(0, 6)} (started ${ageMinutes} minute${ageMinutes === 1 ? '' : 's'} ago)`,
      `cwd:      ${ctx.cwd}`,
    ].join('\n');

    ctx.session.writeInfo(text);
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};
