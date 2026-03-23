import { useEffect, useMemo, useState } from 'react';
import type { CommandEntry } from '../../commands/types.ts';
import type { CommandRegistry } from '../../commands/registry.ts';

interface UseSlashCommandTypeaheadOptions {
  input: string;
  registry: CommandRegistry | null;
}

export function useSlashCommandTypeahead({
  input,
  registry,
}: UseSlashCommandTypeaheadOptions): {
  suggestions: CommandEntry[];
  selectedIndex: number;
  selectNext: () => void;
  selectPrev: () => void;
  confirm: () => CommandEntry | undefined;
  dismiss: () => void;
} {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const suggestions = useMemo(() => {
    if (!registry || !input.startsWith('/')) {
      return [];
    }

    const trimmed = input.slice(1);
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex !== -1) {
      return [];
    }

    return trimmed.length === 0
      ? registry.list().slice(0, 8)
      : registry.search(trimmed);
  }, [input, registry]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(suggestions.length - 1, 0)));
  }, [suggestions]);

  return {
    suggestions,
    selectedIndex,
    selectNext: () => setSelectedIndex((current) => (current + 1) % Math.max(suggestions.length, 1)),
    selectPrev: () =>
      setSelectedIndex((current) => (current + Math.max(suggestions.length, 1) - 1) % Math.max(suggestions.length, 1)),
    confirm: () => suggestions[selectedIndex],
    dismiss: () => setSelectedIndex(0),
  };
}
