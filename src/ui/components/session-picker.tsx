import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SessionSnapshotSummary } from '../../commands/types.ts';

interface SessionPickerProps {
  sessions: SessionSnapshotSummary[];
  onSelect: (session: SessionSnapshotSummary) => void;
  onCancel: () => void;
}

export function SessionPicker({ sessions, onSelect, onCancel }: SessionPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((current) => (current + sessions.length - 1) % Math.max(sessions.length, 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((current) => (current + 1) % Math.max(sessions.length, 1));
      return;
    }
    if (key.return) {
      const next = sessions[selectedIndex];
      if (next) {
        onSelect(next);
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
      <Text bold>Saved sessions</Text>
      {sessions.map((session, index) => (
        <Text key={session.id} color={index === selectedIndex ? 'cyan' : undefined}>
          {`${index === selectedIndex ? '›' : ' '} ${session.id.slice(0, 8)} | ${new Date(session.startedAt).toLocaleString()} | ${session.messageCount} msgs | $${session.totalCostUsd.toFixed(6)}`}
        </Text>
      ))}
      <Text color="gray">Use arrows and Enter to restore. Esc cancels.</Text>
    </Box>
  );
}
