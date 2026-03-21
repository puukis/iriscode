import type { BuiltinHandler, CommandEntry } from '../types.ts';
import type { PermissionMode } from '../../permissions/types.ts';

export const MODE_COMMAND: CommandEntry = {
  name: 'mode',
  description: 'Show or switch the active permission mode.',
  category: 'builtin',
  argumentHint: '[default|acceptEdits|plan]',
};

export const handleMode: BuiltinHandler = async (ctx) => {
  try {
    const nextMode = ctx.args[0] as PermissionMode | undefined;
    if (!nextMode) {
      ctx.session.writeInfo(`Current mode: ${ctx.engine.getMode()}`);
      return { type: 'handled' };
    }

    if (nextMode !== 'default' && nextMode !== 'acceptEdits' && nextMode !== 'plan') {
      return { type: 'error', message: `Unknown mode "${nextMode}".` };
    }

    ctx.engine.setMode(nextMode);
    ctx.session.setMode(nextMode);
    ctx.session.writeInfo(`Mode switched to: ${nextMode}`);
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};
