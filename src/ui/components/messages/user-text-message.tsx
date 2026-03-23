import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { IrisMessage } from '../../context.ts';
import { theme } from '../../theme.ts';
import { useTerminalSize } from '../../hooks/use-terminal-size.ts';

interface UserTextMessageProps {
  message: Extract<IrisMessage, { kind: 'user-text' }>;
}

export const UserTextMessage = memo(function UserTextMessage({ message }: UserTextMessageProps) {
  const { columns } = useTerminalSize();
  const barWidth = Math.max(12, columns - 4);

  if (message.commandName) {
    return (
      <Box marginBottom={1}>
        <Text color={theme.colors.skill}>{`⚡ skill: ${message.commandName} loading...`}</Text>
      </Box>
    );
  }

  const lines = message.text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);

  return (
    <Box marginBottom={1} flexDirection="column">
      {lines.map((line, i) => {
        const prefix = i === 0 ? '❯ ' : '  ';
        const raw = `${prefix}${line}`;
        const display = raw.length > barWidth
          ? `${raw.slice(0, Math.max(1, barWidth - 1))}…`
          : raw.padEnd(barWidth, ' ');
        return (
          <Text key={i} backgroundColor={theme.colors.surface} color={theme.colors.surfaceText} bold>
            {display}
          </Text>
        );
      })}
    </Box>
  );
});
