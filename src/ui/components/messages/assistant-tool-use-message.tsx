import React, { memo, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { IrisMessage } from '../../context.ts';
import { getPermissionRiskLevel } from '../permission-prompt.tsx';
import { UserToolResultMessage } from './user-tool-result-message.tsx';
import { theme } from '../../theme.ts';

interface AssistantToolUseMessageProps {
  message: Extract<IrisMessage, { kind: 'assistant-tool-use' }>;
  focused?: boolean;
}

export const AssistantToolUseMessage = memo(function AssistantToolUseMessage({
  message,
  focused = false,
}: AssistantToolUseMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => {
    if (message.calls.length === 1) {
      const call = message.calls[0];
      return `⚙ ${call.name} (${summarizeInput(call.input)})`;
    }
    return `⚙ ${message.calls.length} tool calls ▸`;
  }, [message.calls]);

  useInput((_input, key) => {
    if (!focused || !key.return) {
      return;
    }
    setExpanded((current) => !current);
  }, { isActive: focused });

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.colors.muted}>{summary}</Text>
      {expanded ? (
        <Box flexDirection="column" marginLeft={2}>
          {message.calls.map((call) => (
            <Box key={call.id} flexDirection="column" marginBottom={1}>
              <Text color={theme.colors.muted}>
                {`${call.name} [${getPermissionRiskLevel(call.name).toUpperCase()}] ${call.durationMs ? `${call.durationMs}ms` : ''}`}
              </Text>
              <Text color={theme.colors.dim}>{JSON.stringify(call.input, null, 2)}</Text>
              {call.output ? <UserToolResultMessage call={call} /> : null}
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
});

function summarizeInput(input: Record<string, unknown>): string {
  const firstEntry = Object.entries(input)[0];
  if (!firstEntry) {
    return 'no input';
  }

  const [, value] = firstEntry;
  return typeof value === 'string' ? value : JSON.stringify(value);
}
