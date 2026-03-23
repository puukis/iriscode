import type { Key } from 'ink';

export type VimModeName = 'normal' | 'insert' | 'visual';

export class VimModeController {
  mode: VimModeName = 'insert';
  private pendingOperator = '';

  constructor(enabled = false) {
    this.mode = enabled ? 'normal' : 'insert';
  }

  isEnabled(): boolean {
    return this.mode !== 'insert' || this.pendingOperator.length >= 0;
  }

  setMode(mode: VimModeName): void {
    this.mode = mode;
    this.pendingOperator = '';
  }

  handle(input: string, key: Key): { action?: string; handled: boolean } {
    if (this.mode === 'insert') {
      if (key.escape) {
        this.mode = 'normal';
        return { handled: true, action: 'to-normal' };
      }
      return { handled: false };
    }

    if (this.mode === 'visual') {
      if (key.escape) {
        this.mode = 'normal';
        return { handled: true, action: 'to-normal' };
      }
      return { handled: false };
    }

    switch (input) {
      case 'i':
        this.mode = 'insert';
        return { handled: true, action: 'to-insert' };
      case 'a':
        this.mode = 'insert';
        return { handled: true, action: 'append' };
      case 'v':
        this.mode = 'visual';
        return { handled: true, action: 'to-visual' };
      case 'h':
        return { handled: true, action: 'left' };
      case 'l':
        return { handled: true, action: 'right' };
      case 'w':
        return { handled: true, action: 'word-right' };
      case 'b':
        return { handled: true, action: 'word-left' };
      case '0':
        return { handled: true, action: 'line-start' };
      case '$':
        return { handled: true, action: 'line-end' };
      case 'p':
        return { handled: true, action: 'paste' };
      case 'y':
        if (this.pendingOperator === 'y') {
          this.pendingOperator = '';
          return { handled: true, action: 'yank-line' };
        }
        this.pendingOperator = 'y';
        return { handled: true };
      case 'd':
        if (this.pendingOperator === 'd') {
          this.pendingOperator = '';
          return { handled: true, action: 'delete-line' };
        }
        this.pendingOperator = 'd';
        return { handled: true };
      default:
        this.pendingOperator = '';
        return { handled: false };
    }
  }
}
