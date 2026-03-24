import React, { memo, useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { IrisMessage } from '../../context.ts';
import { theme } from '../../theme.ts';
import { renderMarkdown } from '../../utils/markdown-to-ansi.ts';

const MAX_LINES = 50;

interface AssistantTextMessageProps {
  message: Extract<IrisMessage, { kind: 'assistant-text' }>;
}

export const AssistantTextMessage = memo(function AssistantTextMessage({
  message,
}: AssistantTextMessageProps) {
  const [spinnerIndex, setSpinnerIndex] = useState(0);

  // Convert markdown → ANSI strings once per text change.
  // string-width (used by Ink's layout) correctly strips ANSI codes,
  // so Yoga measures only visible characters.
  const allLines = useMemo(() => renderMarkdown(message.text), [message.text]);
  const lines = allLines.length > MAX_LINES ? allLines.slice(0, MAX_LINES) : allLines;

  useEffect(() => {
    if (!message.isStreaming) return;
    const timer = setInterval(() => {
      setSpinnerIndex((s) => (s + 1) % theme.spinners.dots.length);
    }, 80);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [message.isStreaming]);

  const bullet = message.isStreaming ? theme.spinners.dots[spinnerIndex] : '•';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {lines.map((line, index) => (
        <Box key={`${message.id}:${index}`}>
          {/* Gutter: bullet on first line, indent on rest */}
          <Text color={theme.colors.surfaceText}>
            {index === 0 ? `${bullet} ` : '  '}
          </Text>
          {/* ANSI-formatted content – no Ink color props so codes pass through */}
          <Text>{line || ' '}</Text>
        </Box>
      ))}
      {allLines.length > MAX_LINES && (
        <Text color={theme.colors.muted}>{'  … truncated'}</Text>
      )}
    </Box>
  );
});
