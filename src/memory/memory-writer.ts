import { appendToMemory } from './store.ts';
import type { Session } from '../agent/session.ts';
import type { ModelRegistry } from '../models/registry.ts';
import type { Message } from '../shared/types.ts';

const MIN_MESSAGES_TO_WRITE = 4;

const CHEAP_MODEL_IDS = [
  'anthropic/claude-haiku-4-5-20251001',
  'google/gemini-1.5-flash',
  'openai/gpt-4o-mini',
];

const EXTRACTION_PROMPT =
  'Review this coding session and extract any important patterns, preferences, corrections, ' +
  'or context that would be useful in future sessions. Write 3-10 concise bullet points in markdown. ' +
  'Focus on: coding style preferences, recurring corrections, project-specific conventions, ' +
  'things the user explicitly asked to remember. Skip anything obvious or already well-known. ' +
  'Start each bullet with - ';

/**
 * Extracts session learnings and appends them to ~/.iris/projects/<hash>/MEMORY.md.
 * Runs asynchronously — caller should not await if they want it fire-and-forget.
 * Only runs if the session has at least MIN_MESSAGES_TO_WRITE messages.
 */
export async function writeMemoryFromSession(
  session: Session,
  modelRegistry: ModelRegistry,
): Promise<void> {
  if (session.messages.length < MIN_MESSAGES_TO_WRITE) {
    return;
  }

  const adapter = pickAdapter(session.model, modelRegistry);
  if (!adapter) {
    return;
  }

  try {
    const historySlice: Message[] = session.messages.slice(-60);
    const messages: Message[] = [
      ...historySlice,
      { role: 'user', content: EXTRACTION_PROMPT },
    ];

    let result = '';
    for await (const event of adapter.stream({ messages, systemPrompt: undefined, tools: [] })) {
      if (event.type === 'text') {
        result += event.text ?? '';
      }
    }

    if (result.trim()) {
      const timestamp = new Date().toISOString().slice(0, 10);
      const entry = `\n<!-- Session ${session.id} — ${timestamp} -->\n${result.trim()}\n`;
      await appendToMemory(session.cwd, entry, 'project');
    }
  } catch {
    // Non-fatal: memory writing is best-effort
  }
}

function pickAdapter(currentModel: string, registry: ModelRegistry) {
  for (const id of CHEAP_MODEL_IDS) {
    if (registry.has(id)) {
      try {
        return registry.get(id);
      } catch {
        continue;
      }
    }
  }
  if (registry.has(currentModel)) {
    try {
      return registry.get(currentModel);
    } catch {
      return null;
    }
  }
  return null;
}
