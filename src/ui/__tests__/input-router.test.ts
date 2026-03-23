import { describe, expect, test } from 'bun:test';
import type { Key } from 'ink';
import { InputRouter } from '../input-router.ts';

const EMPTY_KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
};

describe('InputRouter', () => {
  test('routes ctrl+o to activity toggle instead of text editing', () => {
    const router = new InputRouter(false);
    const calls: string[] = [];

    router.route('o', { ...EMPTY_KEY, ctrl: true }, {
      onHistoryNavigate: () => calls.push('history'),
      onTypeaheadConfirm: () => calls.push('typeahead'),
      onDismiss: () => calls.push('dismiss'),
      onSubmit: () => calls.push('submit'),
      onCancel: () => calls.push('cancel'),
      onClearScreen: () => calls.push('clear'),
      onOpenCommandPalette: () => calls.push('palette'),
      onOpenMcp: () => calls.push('mcp'),
      onToggleActivity: () => calls.push('activity'),
      onCycleMode: () => calls.push('mode'),
      onEdit: () => calls.push('edit'),
    });

    expect(calls).toEqual(['activity']);
  });
});
