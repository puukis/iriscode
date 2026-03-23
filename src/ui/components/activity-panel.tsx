import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.ts';

export interface ActivityEntry {
  id: string;
  createdAt: number;
  title: string;
  detail?: string;
  kind: 'info' | 'error' | 'agent' | 'tool' | 'mcp';
  status: 'neutral' | 'running' | 'success' | 'error';
}

interface ActivityPanelProps {
  entries: ActivityEntry[];
  maxVisible?: number;
}

export const ActivityPanel = memo(function ActivityPanel({
  entries,
  maxVisible = 10,
}: ActivityPanelProps) {
  const visibleEntries = useMemo(
    () => entries.slice(-Math.max(1, maxVisible)),
    [entries, maxVisible],
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.colors.accent} paddingX={1} marginBottom={1}>
      <Box justifyContent="space-between">
        <Text bold>Activity</Text>
        <Text color={theme.colors.dim}>ctrl+o to collapse</Text>
      </Box>

      {visibleEntries.length === 0 ? (
        <Text color={theme.colors.dim}>No activity yet.</Text>
      ) : visibleEntries.map((entry) => (
        <Box key={entry.id} flexDirection="column" marginTop={1}>
          <Text color={colorForEntry(entry)}>
            {`${formatTimestamp(entry.createdAt)} ${statusLabel(entry.status)} ${entry.title}`}
          </Text>
          {entry.detail ? <Text color={theme.colors.dim}>{entry.detail}</Text> : null}
        </Box>
      ))}

      {entries.length > visibleEntries.length ? (
        <Text color={theme.colors.dim}>{`Showing last ${visibleEntries.length} of ${entries.length} entries.`}</Text>
      ) : null}
    </Box>
  );
});

function colorForEntry(entry: ActivityEntry): string {
  if (entry.status === 'error' || entry.kind === 'error') {
    return theme.colors.error;
  }
  if (entry.status === 'running') {
    return theme.colors.warning;
  }
  if (entry.status === 'success') {
    return theme.colors.success;
  }
  if (entry.kind === 'mcp') {
    return theme.colors.accent;
  }
  if (entry.kind === 'agent') {
    return theme.colors.primary;
  }
  return theme.colors.muted;
}

function statusLabel(status: ActivityEntry['status']): string {
  if (status === 'running') {
    return '[run]';
  }
  if (status === 'success') {
    return '[ok]';
  }
  if (status === 'error') {
    return '[err]';
  }
  return '[log]';
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toTimeString().slice(0, 8);
}
