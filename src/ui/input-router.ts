import type { Key } from 'ink';
import { VimModeController } from './vim-mode.ts';

export interface InputRouterHandlers {
  onHistoryNavigate: (key: Key) => void;
  onTypeaheadConfirm: () => void;
  onDismiss: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  onClearScreen: () => void;
  onOpenCommandPalette: () => void;
  onOpenMcp: () => void;
  onToggleActivity: () => void;
  onCycleMode: () => void;
  onEdit: (input: string, key: Key) => void;
}

export class InputRouter {
  readonly vim: VimModeController;

  constructor(vimEnabled = false) {
    this.vim = new VimModeController(vimEnabled);
  }

  route(input: string, key: Key, handlers: InputRouterHandlers): void {
    if (this.vim.mode !== 'insert') {
      const result = this.vim.handle(input, key);
      if (result.handled) {
        switch (result.action) {
          case 'left':
            handlers.onEdit('', { ...key, leftArrow: true });
            return;
          case 'right':
            handlers.onEdit('', { ...key, rightArrow: true });
            return;
          case 'word-left':
            handlers.onEdit('b', { ...key, ctrl: true });
            return;
          case 'word-right':
            handlers.onEdit('f', { ...key, ctrl: true });
            return;
          case 'line-start':
            handlers.onEdit('a', { ...key, ctrl: true });
            return;
          case 'line-end':
            handlers.onEdit('e', { ...key, ctrl: true });
            return;
          default:
            return;
        }
      }
    }

    if (key.ctrl && input === 'r') {
      handlers.onHistoryNavigate({ ...key, upArrow: true });
      return;
    }
    if (key.shift && key.tab) {
      handlers.onCycleMode();
      return;
    }
    if (key.tab) {
      handlers.onTypeaheadConfirm();
      return;
    }
    if (key.escape) {
      handlers.onDismiss();
      return;
    }
    if (key.return) {
      handlers.onSubmit();
      return;
    }
    if (key.ctrl && input === 'c') {
      handlers.onCancel();
      return;
    }
    if (key.ctrl && input === 'l') {
      handlers.onClearScreen();
      return;
    }
    if (key.ctrl && input === 'k') {
      handlers.onOpenCommandPalette();
      return;
    }
    if (key.ctrl && input === 'g') {
      handlers.onOpenMcp();
      return;
    }
    if (key.ctrl && input === 'o') {
      handlers.onToggleActivity();
      return;
    }
    if (key.upArrow || key.downArrow) {
      handlers.onHistoryNavigate(key);
      return;
    }

    handlers.onEdit(input, key);
  }
}
