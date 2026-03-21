import { readFile } from 'fs/promises';
import { resolve } from 'path';
import type { PermissionMode } from '../permissions/types.ts';
import { computeDiff } from './engine.ts';
import { DiffStore } from './store.ts';
import { DiffViewerController, type DiffDecision } from './controller.ts';

export class DiffInterceptor {
  private mode: PermissionMode;
  private readonly store: DiffStore;
  private readonly ui: DiffViewerController;

  constructor(store: DiffStore, mode: PermissionMode, ui: DiffViewerController) {
    this.store = store;
    this.mode = mode;
    this.ui = ui;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  async intercept(filePath: string, proposedContent: string): Promise<DiffDecision> {
    const absolutePath = resolve(filePath);
    const before = await readCurrentFile(absolutePath);
    const diff = computeDiff(before, proposedContent, absolutePath);

    if (diff.isEmpty) {
      return 'accepted';
    }

    if (this.mode === 'plan') {
      return 'accepted';
    }

    const decision = await this.ui.show(diff, this.mode === 'acceptEdits');
    this.store.add(diff, decision);
    return decision;
  }

  acceptAll(): void {
    this.ui.acceptAll();
  }
}

async function readCurrentFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}
