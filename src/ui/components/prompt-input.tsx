import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Key } from 'ink';
import type { CommandRegistry } from '../../commands/registry.ts';
import { theme } from '../theme.ts';
import { useTextInput } from '../hooks/use-text-input.ts';
import { useArrowKeyHistory } from '../hooks/use-arrow-key-history.ts';
import { useSlashCommandTypeahead } from '../hooks/use-slash-command-typeahead.ts';
import { useIris } from '../context.ts';
import { useBracketedPaste } from '../stdin-proxy.ts';

const EMPTY_KEY: Key = {
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
  pageDown: false, pageUp: false, return: false, escape: false,
  ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false,
};

const PASTE_TOKEN_RE = /\[Pasted text #(\d+)(?:[^\]]*)\]/g;

function makePasteToken(id: number, content: string): string {
  const lines = content.split(/\r\n|\r|\n/).length;
  if (lines > 1) {
    return `[Pasted text #${id} +${lines - 1} line${lines > 2 ? 's' : ''}]`;
  }
  return `[Pasted text #${id}]`;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function expandPasteTokens(value: string, store: Map<number, string>): string {
  return value.replace(PASTE_TOKEN_RE, (_, n) => store.get(Number(n)) ?? '');
}

interface PromptInputProps {
  history: string[];
  registry: CommandRegistry | null;
  placeholder?: string;
  isDisabled?: boolean;
  isActive?: boolean;
  canCancelWithEscape?: boolean;
  canExitWithEscape?: boolean;
  onSubmit: (value: string) => Promise<void> | void;
  onCycleMode?: () => void;
  onOpenMcp?: () => void;
  onToggleActivity?: () => void;
  onSuggestionsChange?: (state: {
    suggestions: ReturnType<typeof useSlashCommandTypeahead>['suggestions'];
    selectedIndex: number;
  }) => void;
}

export function PromptInput({
  history,
  registry,
  placeholder = '',
  isDisabled = false,
  isActive = true,
  canCancelWithEscape = false,
  canExitWithEscape = false,
  onSubmit,
  onCycleMode,
  onOpenMcp,
  onToggleActivity,
  onSuggestionsChange,
}: PromptInputProps) {
  const iris = useIris();
  const [value, setValue] = useState('');
  const [exitArmed, setExitArmed] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pasteCounterRef = useRef(0);
  const pasteStoreRef = useRef(new Map<number, string>());

  const { onInput, renderedValue } = useTextInput({
    value,
    onChange: setValue,
    onSubmit: async (nextValue) => {
      const expanded = normalizeLineEndings(expandPasteTokens(nextValue, pasteStoreRef.current));
      await onSubmit(expanded);
      setValue('');
      pasteStoreRef.current.clear();
      persistHistory(expanded);
    },
    multiline: true,
  });
  const { onNavigate, persistHistory } = useArrowKeyHistory({
    history,
    onNavigate: setValue,
  });
  const typeahead = useSlashCommandTypeahead({ input: value, registry });

  const clearExitArm = useCallback(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setExitArmed(false);
  }, []);

  const armExit = useCallback(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
    }
    setExitArmed(true);
    exitTimerRef.current = setTimeout(() => {
      setExitArmed(false);
      exitTimerRef.current = null;
    }, 1500);
    exitTimerRef.current.unref?.();
  }, []);

  const handleIdleEscape = useCallback(() => {
    if (!canExitWithEscape || value.length > 0 || typeahead.suggestions.length > 0) {
      return false;
    }
    if (exitArmed) {
      clearExitArm();
      void iris.runtime.exitRef.current();
    } else {
      armExit();
    }
    return true;
  }, [armExit, canExitWithEscape, clearExitArm, exitArmed, iris.runtime.exitRef, typeahead.suggestions.length, value.length]);

  useEffect(() => {
    onSuggestionsChange?.({
      suggestions: typeahead.suggestions,
      selectedIndex: typeahead.selectedIndex,
    });
  }, [onSuggestionsChange, typeahead.selectedIndex, typeahead.suggestions]);

  useEffect(() => () => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
    }
  }, []);

  useBracketedPaste((content) => {
    if (!isDisabled && content.length > 0) {
      pasteCounterRef.current += 1;
      const id = pasteCounterRef.current;
      pasteStoreRef.current.set(id, content);
      onInput(makePasteToken(id, content), EMPTY_KEY);
    }
  }, { isActive });

  useInput((input, _key) => {
    if (!isActive) {
      return;
    }

    const key = _key;

    if (isDisabled) {
      if (canCancelWithEscape && key.escape) {
        if (exitArmed) {
          clearExitArm();
          void iris.runtime.exitRef.current();
        } else {
          armExit();
          iris.runtime.cancelRef.current();
        }
        return;
      }
      if (key.ctrl && input === 'c') {
        clearExitArm();
        iris.runtime.cancelRef.current();
        return;
      }
      if (key.ctrl && input === 'o') {
        clearExitArm();
        onToggleActivity?.();
      }
      return;
    }

    if (!(key.escape && canExitWithEscape && value.length === 0)) {
      clearExitArm();
    }

    iris.inputRouterRef.current.route(input, key, {
      onHistoryNavigate: (historyKey) => onNavigate(historyKey, value),
      onTypeaheadConfirm: () => {
        clearExitArm();
        const confirmed = typeahead.confirm();
        if (confirmed) {
          setValue(`/${confirmed.name} `);
        }
      },
      onDismiss: () => {
        if (handleIdleEscape()) {
          return;
        }
        typeahead.dismiss();
      },
      onSubmit: () => {
        clearExitArm();
        const expanded = normalizeLineEndings(expandPasteTokens(value, pasteStoreRef.current));
        void onSubmit(expanded);
        if (expanded.trim()) {
          persistHistory(expanded);
        }
        setValue('');
        pasteStoreRef.current.clear();
        pasteCounterRef.current = 0;
      },
      onCancel: () => iris.runtime.cancelRef.current(),
      onClearScreen: () => {
        clearExitArm();
        process.stdout.write('\x1bc');
      },
      onOpenCommandPalette: () => {
        clearExitArm();
        setValue('/');
      },
      onOpenMcp: () => {
        clearExitArm();
        void onOpenMcp?.();
      },
      onToggleActivity: () => {
        clearExitArm();
        onToggleActivity?.();
      },
      onCycleMode: () => {
        onCycleMode?.();
      },
      onEdit: (nextInput, nextKey) => {
        onInput(nextInput, nextKey);
      },
    });
  });

  const promptLabel = isDisabled ? '[running - Esc to cancel]' : '>';
  const characterCount = value.length > 1000 ? `${value.length} chars` : null;
  const exitHint = exitArmed ? 'Press Esc again to exit.' : null;
  const promptValue = renderedValue;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={isDisabled ? theme.colors.dim : theme.colors.text}>{`${promptLabel} `}</Text>
        <Text color={value.length === 0 && placeholder ? theme.colors.dim : undefined}>
          {value.length > 0 || !placeholder ? promptValue : placeholder}
        </Text>
      </Box>
      {characterCount ? <Text color={theme.colors.dim}>{characterCount}</Text> : null}
      {exitHint ? <Text color={theme.colors.dim}>{exitHint}</Text> : null}
    </Box>
  );
}
