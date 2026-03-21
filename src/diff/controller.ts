import type { DiffResult } from '../shared/types.ts';

export type DiffDecision = 'accepted' | 'rejected';

export type DiffViewerRequest =
  | {
      kind: 'interactive';
      result: DiffResult;
      autoAccept: boolean;
      acceptAll: () => void;
      resolve: (decision: DiffDecision) => void;
    }
  | {
      kind: 'readonly';
      result: DiffResult;
      resolve: () => void;
    };

type Presenter = (request: DiffViewerRequest) => void | Promise<void>;

export class DiffViewerController {
  private readonly presenter?: Presenter;
  private queue: Promise<void> = Promise.resolve();
  private acceptRemaining = false;

  constructor(presenter?: Presenter) {
    this.presenter = presenter;
  }

  async show(result: DiffResult, autoAccept: boolean): Promise<DiffDecision> {
    if (this.acceptRemaining) {
      autoAccept = true;
    }

    return this.enqueue<DiffDecision>(() => {
      if (!this.presenter) {
        return Promise.resolve('accepted');
      }

      return new Promise<DiffDecision>((resolve) => {
        void this.presenter?.({
          kind: 'interactive',
          result,
          autoAccept,
          acceptAll: () => {
            this.acceptRemaining = true;
          },
          resolve: (decision) => {
            resolve(decision);
          },
        });
      });
    });
  }

  async showReadOnly(result: DiffResult): Promise<void> {
    return this.enqueue<void>(() => {
      if (!this.presenter) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        void this.presenter?.({
          kind: 'readonly',
          result,
          resolve,
        });
      });
    });
  }

  acceptAll(): void {
    this.acceptRemaining = true;
  }

  reset(): void {
    this.acceptRemaining = false;
  }

  isAcceptAllEnabled(): boolean {
    return this.acceptRemaining;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
