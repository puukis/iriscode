import type { BuiltinHandler, CommandEntry } from '../types.ts';

export const CLEAR_COMMAND: CommandEntry = {
  name: 'clear',
  description: 'Clear the current session history back to an empty conversation.',
  category: 'builtin',
};

export const handleClear: BuiltinHandler = async (ctx) => {
  try {
    ctx.session.clear();
    ctx.session.showCommand('/clear');
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};
