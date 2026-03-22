import { bus } from '../shared/events.ts';
import { buildSystemPrompt } from './retrieval.ts';
import { estimateTokens } from './loader.ts';
import type { SessionState } from '../commands/types.ts';
import type { CompactionManager } from './compaction.ts';
import type { ModelRegistry } from '../models/registry.ts';
import type { Message } from '../shared/types.ts';

const ON_DEMAND_PROMPT =
  'Summarize this conversation so far in a concise markdown document. ' +
  'Include: what the user is working on, key decisions made, files modified, ' +
  'and any important context. Be concise - max 300 words.';

/** Preferred cheap models for on-demand summarization */
const CHEAP_MODEL_IDS = [
  'anthropic/claude-haiku-4-5-20251001',
  'google/gemini-1.5-flash',
  'openai/gpt-4o-mini',
];

export interface CompactionResult {
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
  source: 'prewritten' | 'generated';
}

export async function compactSession(
  session: SessionState,
  compactionManager: CompactionManager,
  modelRegistry: ModelRegistry,
  extraInstructions?: string,
): Promise<CompactionResult> {
  const tokensBefore = estimateTokens(
    session.messages
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n'),
  );

  // 1. Force-write pre-computed summary
  await compactionManager.writeSummaryNow();

  // 2. Load pre-written summary
  let summary = await compactionManager.loadSummary();
  let source: 'prewritten' | 'generated' = 'prewritten';

  // 3. If no pre-written summary: generate on the spot
  if (!summary) {
    source = 'generated';
    summary = await generateOnDemand(session, modelRegistry);
  }

  // 4. Append extra instructions if provided
  if (extraInstructions?.trim()) {
    summary = `${summary}\n\nFocus: ${extraInstructions.trim()}`;
  }

  // 5. Compact session
  session.compact(summary);

  // 6. Re-build system prompt from disk (best-effort)
  try {
    const { systemPrompt } = await buildSystemPrompt(session.cwd, '');
    void systemPrompt;
  } catch {
    // Non-fatal
  }

  const tokensAfter = estimateTokens(
    session.messages
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n'),
  );

  const result: CompactionResult = { summary, tokensBefore, tokensAfter, source };
  bus.emit('session:compacted', {
    tokensBefore,
    tokensAfter,
    source,
    summary,
  });

  return result;
}

async function generateOnDemand(session: SessionState, modelRegistry: ModelRegistry): Promise<string> {
  const adapter = pickAdapter(session.model, modelRegistry);
  if (!adapter) {
    // Fallback: return a plain text summary of display messages
    return session.displayMessages
      .filter((m) => m.role !== 'system')
      .slice(-20)
      .map((m) => `${m.role}: ${m.text}`)
      .join('\n');
  }

  const historySlice: Message[] = session.messages.slice(-40);
  const messages: Message[] = [
    ...historySlice,
    { role: 'user', content: ON_DEMAND_PROMPT },
  ];

  let summary = '';
  for await (const event of adapter.stream({ messages, tools: [], systemPrompt: undefined })) {
    if (event.type === 'text') {
      summary += event.text ?? '';
    }
  }
  return summary.trim() || 'Session compacted. No summary available.';
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
