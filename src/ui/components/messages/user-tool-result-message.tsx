import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { IrisToolCallMessage } from '../../context.ts';
import { theme } from '../../theme.ts';

interface UserToolResultMessageProps {
  call: IrisToolCallMessage;
}

export const UserToolResultMessage = memo(function UserToolResultMessage({
  call,
}: UserToolResultMessageProps) {
  const lines = (call.output ?? '').split('\n');
  const truncated = lines.length > 20 ? lines.slice(0, 20) : lines;
  const color = call.isError ? theme.colors.error : theme.colors.success;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      {truncated.map((line, index) => (
        <Text key={`${call.id}:${index}`} color={call.isError ? theme.colors.error : undefined}>
          {line}
        </Text>
      ))}
      {lines.length > 20 ? <Text color={theme.colors.dim}>... output truncated</Text> : null}
    </Box>
  );
});
