import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { getSessionDir } from './project-hash.ts';
import type { Session } from '../agent/session.ts';
import type { ModelRegistry } from '../models/registry.ts';
import type { Message } from '../shared/types.ts';

/** Model IDs to try for cheap summarization, in priority order */
const CHEAP_MODEL_IDS = [
  'anthropic/claude-haiku-4-5-20251001',
  'google/gemini-1.5-flash',
  'openai/gpt-4o-mini',
];

const SUMMARY_PROMPT =
  'Summarize this conversation so far in a concise markdown document. ' +
  'Include: what the user is working on, key decisions made, files modified, ' +
  'and any important context. Be concise - max 300 words.';

const WRITE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const MESSAGE_DELTA_THRESHOLD = 10;

export class CompactionManager {
  private session: Session;
  private modelRegistry: ModelRegistry;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWrittenMessageCount = 0;
  private writing = false;

  constructor(session: Session, modelRegistry: ModelRegistry) {
    this.session = session;
    this.modelRegistry = modelRegistry;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      const delta = this.session.messages.length - this.lastWrittenMessageCount;
      if (delta >= MESSAGE_DELTA_THRESHOLD) {
        void this.writeSummaryNow();
      }
    }, WRITE_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async writeSummaryNow(): Promise<void> {
    if (this.writing || this.session.messages.length < 2) {
      return;
    }

    this.writing = true;
    try {
      const summary = await this.generateSummary();
      if (!summary) {
        return;
      }
      const summaryPath = this.getSummaryPath();
      mkdirSync(dirname(summaryPath), { recursive: true });
      writeFileSync(summaryPath, `${summary.trim()}\n`, 'utf-8');
      this.lastWrittenMessageCount = this.session.messages.length;
    } catch {
      // Background writes are best-effort — never crash the session
    } finally {
      this.writing = false;
    }
  }

  async loadSummary(): Promise<string | null> {
    const summaryPath = this.getSummaryPath();
    if (!existsSync(summaryPath)) {
      return null;
    }
    try {
      const { readFileSync } = await import('fs');
      return readFileSync(summaryPath, 'utf-8');
    } catch {
      return null;
    }
  }

  getSummaryPath(): string {
    return resolve(getSessionDir(this.session.cwd, this.session.id), 'summary.md');
  }

  private async generateSummary(): Promise<string | null> {
    const adapter = this.pickAdapter();
    if (!adapter) {
      return null;
    }

    // Use last 40 messages to stay within token limits for cheap models
    const historySlice: Message[] = this.session.messages.slice(-40);
    const messages: Message[] = [
      ...historySlice,
      { role: 'user', content: SUMMARY_PROMPT },
    ];

    let summary = '';
    for await (const event of adapter.stream({ messages, systemPrompt: undefined })) {
      if (event.type === 'text') {
        summary += event.text ?? '';
      }
    }
    return summary || null;
  }

  private pickAdapter() {
    for (const modelId of CHEAP_MODEL_IDS) {
      if (this.modelRegistry.has(modelId)) {
        try {
          return this.modelRegistry.get(modelId);
        } catch {
          continue;
        }
      }
    }
    // Fall back to session's current model
    if (this.modelRegistry.has(this.session.model)) {
      try {
        return this.modelRegistry.get(this.session.model);
      } catch {
        return null;
      }
    }
    return null;
  }
}
