import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, resolve } from 'path';
import { useMemo, useRef } from 'react';
import type { Key } from 'ink';

const MAX_ENTRIES = 50;
const HISTORY_PATH = resolve(process.env.HOME ?? homedir(), '.iris', 'input-history.txt');

interface UseArrowKeyHistoryOptions {
  history: string[];
  onNavigate: (value: string) => void;
}

export function useArrowKeyHistory({
  history,
  onNavigate,
}: UseArrowKeyHistoryOptions): {
  onNavigate: (key: Key, draft: string) => void;
  persistHistory: (entry: string) => void;
  persistedHistory: string[];
} {
  const indexRef = useRef<number>(-1);
  const draftRef = useRef('');
  const persistedHistory = useMemo(() => loadHistory(), []);
  const mergedHistory = useMemo(
    () => dedupeHistory([...persistedHistory, ...history]),
    [history, persistedHistory],
  );

  const handleNavigate = (key: Key, draft: string) => {
    if (key.upArrow) {
      if (indexRef.current === -1) {
        draftRef.current = draft;
        indexRef.current = mergedHistory.length;
      }
      indexRef.current = Math.max(0, indexRef.current - 1);
      onNavigate(mergedHistory[indexRef.current] ?? draft);
      return;
    }

    if (key.downArrow) {
      if (indexRef.current === -1) {
        return;
      }
      indexRef.current += 1;
      if (indexRef.current >= mergedHistory.length) {
        indexRef.current = -1;
        onNavigate(draftRef.current);
        return;
      }
      onNavigate(mergedHistory[indexRef.current] ?? draftRef.current);
    }
  };

  const persistHistory = (entry: string) => {
    const normalized = entry.trim();
    if (!normalized) {
      return;
    }

    const next = dedupeHistory([...loadHistory(), normalized]).slice(-MAX_ENTRIES);
    writeHistory(next);
    indexRef.current = -1;
    draftRef.current = '';
  };

  return { onNavigate: handleNavigate, persistHistory, persistedHistory };
}

function loadHistory(): string[] {
  try {
    if (!existsSync(HISTORY_PATH)) {
      return [];
    }
    return readFileSync(HISTORY_PATH, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

function writeHistory(entries: string[]): void {
  try {
    mkdirSync(dirname(HISTORY_PATH), { recursive: true });
    Bun.write(HISTORY_PATH, `${entries.join('\n')}\n`);
  } catch {
    try {
      mkdirSync(dirname(HISTORY_PATH), { recursive: true });
      writeFileSync(HISTORY_PATH, `${entries.join('\n')}\n`, 'utf-8');
    } catch {
      // Ignore history persistence failures in the TUI.
    }
  }
}

function dedupeHistory(entries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]?.trim();
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    result.unshift(entry);
  }

  return result.slice(-MAX_ENTRIES);
}
