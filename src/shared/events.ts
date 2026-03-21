import type { DiffResult } from './types.ts';

export interface IrisEvents {
  'diff:ready': DiffResult;
  'session:start': { model: string };
  'session:end': { totalInputTokens: number; totalOutputTokens: number };
  'tool:start': { name: string };
  'tool:end': { name: string; durationMs: number };
  'tool:error': { name: string; error: string };
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
