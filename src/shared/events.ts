import type { DiffResult } from './types.ts';
import type { ResolvedConfig } from '../config/schema.ts';
import type { GraphSnapshot } from '../graph/model.ts';

export interface IrisEvents {
  'agent:start': { depth: number; model: string; description: string };
  'agent:done': { depth: number; model: string; description: string; response: string };
  'diff:ready': DiffResult;
  'diff:decision': {
    filePath: string;
    decision: 'accepted' | 'rejected';
    stats: DiffResult['stats'];
  };
  'session:start': { model: string };
  'session:end': { totalInputTokens: number; totalOutputTokens: number };
  'tool:start': { name: string };
  'tool:call': {
    id: string;
    name: string;
    input: Record<string, unknown>;
    agentId: string;
    startedAt: number;
  };
  'tool:end': { name: string; durationMs: number };
  'tool:result': {
    id: string;
    name: string;
    input: Record<string, unknown>;
    output: string;
    isError: boolean;
    durationMs: number;
    agentId: string;
  };
  'tool:error': { name: string; error: string };
  'cost:update': {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  };
  'config:reloaded': {
    config: ResolvedConfig;
  };
  'graph:update': {
    snapshot: GraphSnapshot;
  };
  'session:saved': {
    sessionId: string;
    path: string;
  };
  'agent:depth-exceeded': {
    agentId: string;
    depth: number;
  };
  'memory:budget': {
    budget: {
      totalTokens: number;
      status: 'ok' | 'warning' | 'exceeded';
      message: string;
      largestFiles: Array<{ path: string; tokens: number }>;
    };
  };
  'session:compacted': {
    tokensBefore: number;
    tokensAfter: number;
    source: 'prewritten' | 'generated';
    summary: string;
  };
  'session:model-changed': { sessionId: string; model: string };
  'session:message-added': { sessionId: string; role: string };
}

type EventHandler<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private handlers = new Map<keyof Events, Set<EventHandler<unknown>>>();

  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
    return () => this.off(event, handler);
  }

  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }
}

export const bus = new EventBus<IrisEvents>();
