import type { BuiltinHandler, CommandEntry } from '../types.ts';
import { Session } from '../../agent/session.ts';

export const SESSIONS_COMMAND: CommandEntry = {
  name: 'sessions',
  description: 'Open the saved-session picker for the current project.',
  category: 'builtin',
};

export const handleSessions: BuiltinHandler = async (ctx) => {
  try {
    const sessions = await Session.listSessions(ctx.cwd);
    if (sessions.length === 0) {
      ctx.session.writeInfo('No saved sessions found for this project.');
      return { type: 'handled' };
    }

    const selected = await ctx.session.openSessionPicker(sessions);
    if (!selected) {
      ctx.session.writeInfo('Session restore cancelled.');
      return { type: 'handled' };
    }

    const answer = await ctx.session.ask('Restore this session? This will replace the current context. (y/n)');
    if (!/^y(es)?$/i.test(answer.trim())) {
      ctx.session.writeInfo('Session restore cancelled.');
      return { type: 'handled' };
    }

    const restored = await Session.load(selected.id, ctx.cwd);
    ctx.session.restoreSession(restored.toSnapshot());
    ctx.session.writeInfo(`Restored session: ${selected.id}`);
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};
