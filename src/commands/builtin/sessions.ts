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
      ctx.session.writeInfo('Session picker closed.');
      return { type: 'handled' };
    }

    const answer = await ctx.session.ask(
      'Restore (r), branch from (b), or cancel (n) this session? [r/b/n]',
    );
    const choice = answer.trim().toLowerCase();

    if (choice === 'r' || choice === 'restore' || choice === 'y' || choice === 'yes') {
      const restored = await Session.load(selected.id, ctx.cwd);
      ctx.session.restoreSession(restored.toSnapshot());
      ctx.session.writeInfo(`Restored session: ${selected.id}`);
      return { type: 'handled' };
    }

    if (choice === 'b' || choice === 'branch') {
      const loaded = await Session.load(selected.id, ctx.cwd);
      const branched = await loaded.branch(loaded.messages.length - 1);
      ctx.session.restoreSession(branched.toSnapshot());
      ctx.session.writeInfo(`Branched from session ${selected.id} → new session ${branched.id}`);
      return { type: 'handled' };
    }

    ctx.session.writeInfo('Session action cancelled.');
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};
