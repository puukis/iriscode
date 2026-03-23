import React, { memo, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { IrisMessage } from '../../context.ts';
import { theme } from '../../theme.ts';

interface AssistantTextMessageProps {
  message: Extract<IrisMessage, { kind: 'assistant-text' }>;
}

const MAX_LINES = 50;

export const AssistantTextMessage = memo(function AssistantTextMessage({
  message,
}: AssistantTextMessageProps) {
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const lines = message.text.split('\n');
  const truncated = lines.length > MAX_LINES ? lines.slice(0, MAX_LINES) : lines;

  useEffect(() => {
    if (!message.isStreaming) {
      return;
    }
    const timer = setInterval(() => {
      setSpinnerIndex((current) => (current + 1) % theme.spinners.dots.length);
    }, 80);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [message.isStreaming]);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {truncated.map((line, index) => (
        <Box key={`${message.id}:${index}`}>
          <Text color={theme.colors.surfaceText}>
            {index === 0
              ? `${message.isStreaming ? theme.spinners.dots[spinnerIndex] : '•'} `
              : '  '}
          </Text>
          <Text color="white">{line || ' '}</Text>
        </Box>
      ))}
      {lines.length > MAX_LINES ? (
        <Text color={theme.colors.muted}>  ... truncated, press expand to view more</Text>
      ) : null}
    </Box>
  );
});
