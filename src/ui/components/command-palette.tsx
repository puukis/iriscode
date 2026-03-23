import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { CommandEntry } from '../../commands/types.ts';
import { theme } from '../theme.ts';

interface CommandPaletteProps {
  query: string;
  entries: CommandEntry[];
  selectedIndex: number;
}

const CATEGORY_COLORS: Record<CommandEntry['category'], 'blue' | 'green' | 'magenta'> = {
  builtin: theme.colors.builtin,
  custom: theme.colors.custom,
  skill: theme.colors.skill,
};

export const CommandPalette = memo(function CommandPalette({ query, entries, selectedIndex }: CommandPaletteProps) {
  if (entries.length === 0) {
    return (
      <Box flexDirection="column" marginBottom={1} marginLeft={2}>
        <Text color={theme.colors.dim}>{`No commands match "${query}".`}</Text>
      </Box>
    );
  }

  let previousCategory: CommandEntry['category'] | null = null;

  return (
    <Box flexDirection="column" marginBottom={1} marginLeft={2}>
      {entries.map((entry, index) => {
        const showHeader = query.trim().length === 0 && previousCategory !== entry.category;
        previousCategory = entry.category;
        const selected = index === selectedIndex;

        return (
          <React.Fragment key={`${entry.category}:${entry.name}`}>
            {showHeader ? (
              <Text color={theme.colors.dim}>{entry.category}</Text>
            ) : null}
            <Box>
              <Text color={selected ? theme.colors.primary : theme.colors.dim}>
                {selected ? '› ' : '  '}
              </Text>
              <Text bold color={selected ? theme.colors.text : undefined}>{`/${entry.name}`}</Text>
              <Text color={CATEGORY_COLORS[entry.category]}>{' • '}</Text>
              <Text color={theme.colors.dim}>{entry.description}</Text>
              {entry.argumentHint ? <Text color={theme.colors.dim}>{`  ${entry.argumentHint}`}</Text> : null}
            </Box>
          </React.Fragment>
        );
      })}
    </Box>
  );
});
