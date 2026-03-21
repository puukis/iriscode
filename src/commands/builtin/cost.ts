import { formatCostReport } from '../../cost/reporter.ts';
import type { BuiltinHandler, CommandEntry } from '../types.ts';

export const COST_COMMAND: CommandEntry = {
  name: 'cost',
  description: 'Print the full current session cost report.',
  category: 'builtin',
};

export const handleCost: BuiltinHandler = async (ctx) => {
  try {
    ctx.session.writeInfo(formatCostReport(ctx.session.costTracker.total()));
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};
