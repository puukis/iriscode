import { bus } from '../shared/events.ts';
import { loadIrisHierarchy } from './loader.ts';
import { checkBudget, MEMORY_MAX_LINES } from './budget.ts';
import { loadMemory } from './store.ts';
import type { IrisSource } from './loader.ts';
import type { BudgetResult } from './budget.ts';

export interface SystemPromptResult {
  systemPrompt: string;
  budget: BudgetResult;
  sources: IrisSource[];
}

/**
 * Builds the full system prompt by injecting:
 *   1. baseSystemPrompt
 *   2. IRIS.md hierarchy (global → project → subdirs → rules)
 *   3. MEMORY.md combined content (capped at 200 lines)
 *
 * Emits `memory:budget` on the event bus after building.
 */
export async function buildSystemPrompt(
  cwd: string,
  baseSystemPrompt: string,
): Promise<SystemPromptResult> {
  const [hierarchy, memory] = await Promise.all([
    loadIrisHierarchy(cwd),
    loadMemory(cwd),
  ]);

  const parts: string[] = [baseSystemPrompt];

  if (hierarchy.contextText) {
    parts.push('--- IRIS CONTEXT ---', hierarchy.contextText);
  }

  if (memory.combined) {
    const cappedLines = memory.combined
      .split('\n')
      .slice(0, MEMORY_MAX_LINES)
      .join('\n')
      .trim();
    if (cappedLines) {
      parts.push('--- MEMORY ---', cappedLines, '--- END MEMORY ---');
    }
  }

  const systemPrompt = parts.join('\n\n');
  const budget = checkBudget(hierarchy, memory.totalLines);

  bus.emit('memory:budget', { budget });

  return { systemPrompt, budget, sources: hierarchy.sources };
}
