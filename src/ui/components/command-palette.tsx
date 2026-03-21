import React from 'react';
import { Box, Text } from 'ink';
import type { CommandEntry } from '../../commands/types.ts';

interface CommandPaletteProps {
  query: string;
  entries: CommandEntry[];
  selectedIndex: number;
}

const CATEGORY_COLORS: Record<CommandEntry['category'], 'blue' | 'green' | 'magenta'> = {
  builtin: 'blue',
  custom: 'green',
  skill: 'magenta',
};

export function CommandPalette({ query, entries, selectedIndex }: CommandPaletteProps) {
  if (entries.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
        <Text dimColor>No commands match "{query}".</Text>
      </Box>
    );
  }

  let previousCategory: CommandEntry['category'] | null = null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      {entries.map((entry, index) => {
        const showHeader = query.trim().length === 0 && previousCategory !== entry.category;
        previousCategory = entry.category;

        return (
          <React.Fragment key={`${entry.category}:${entry.name}`}>
            {showHeader ? (
              <Text color="gray">{entry.category}</Text>
            ) : null}
            <Box>
              <Text color={index === selectedIndex ? 'cyan' : undefined}>
                {index === selectedIndex ? '› ' : '  '}
              </Text>
              <Text bold color={index === selectedIndex ? 'cyan' : undefined}>{`/${entry.name}`}</Text>
              <Text color={CATEGORY_COLORS[entry.category]}>{` [${entry.category}] `}</Text>
              <Text>{entry.description}</Text>
              {entry.argumentHint ? <Text dimColor>{`  ${entry.argumentHint}`}</Text> : null}
            </Box>
          </React.Fragment>
        );
      })}
    </Box>
  );
}
