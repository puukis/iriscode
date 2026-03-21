import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { DiffResult } from '../../shared/types.ts';
import {
  formatDiffLine,
  formatFilePath,
  formatHunkHeader,
  formatStats,
} from '../../diff/formatter.ts';

const MAX_VISIBLE_LINES = 20;

interface DiffViewerProps {
  result: DiffResult;
  mode: 'sideBySide' | 'unified';
  onAccept: () => void;
  onReject: () => void;
  onAcceptAll?: () => void;
  onClose?: () => void;
  autoAccept?: boolean;
  autoAcceptDelayMs?: number;
  readOnly?: boolean;
}

interface UnifiedRow {
  text: string;
  color: 'green' | 'red' | 'dim' | 'white';
  kind: 'meta' | 'content';
}

interface SideBySideCell {
  text: string;
  color: 'green' | 'red' | 'dim' | 'white';
  backgroundColor?: 'green' | 'red';
  marker: '+' | '-' | ' ';
  oldLineNumber?: number;
  newLineNumber?: number;
}

type SideBySideRow =
  | { kind: 'header'; text: string }
  | { kind: 'pair'; left?: SideBySideCell; right?: SideBySideCell };

export function DiffViewer({
  result,
  mode,
  onAccept,
  onReject,
  onAcceptAll,
  onClose,
  autoAccept = false,
  autoAcceptDelayMs = 3000,
  readOnly = false,
}: DiffViewerProps) {
  const terminalWidth = process.stdout.columns ?? 120;
  const effectiveMode = terminalWidth < 120 ? 'unified' : mode;
  const availableWidth = Math.max(48, terminalWidth - 8);
  const columnWidth = Math.max(24, Math.floor((availableWidth - 1) / 2));
  const [showFullFile, setShowFullFile] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [countdownMs, setCountdownMs] = useState(autoAccept ? autoAcceptDelayMs : 0);
  const unifiedRows = useMemo(
    () => (showFullFile ? buildFullUnifiedRows(result) : buildUnifiedRows(result)),
    [result, showFullFile],
  );
  const sideBySideRows = useMemo(
    () =>
      showFullFile
        ? buildFullSideBySideRows(result)
        : buildSideBySideRows(result),
    [result, showFullFile],
  );
  const totalLines = effectiveMode === 'sideBySide'
    ? sideBySideRows.length
    : unifiedRows.length;
  const maxScroll = Math.max(0, totalLines - MAX_VISIBLE_LINES);

  useEffect(() => {
    setScrollOffset((current) => Math.min(current, maxScroll));
  }, [maxScroll]);

  useEffect(() => {
    if (result.isEmpty) {
      if (readOnly) {
        onClose?.();
      } else {
        onAccept();
      }
    }
  }, [onAccept, onClose, readOnly, result.isEmpty]);

  useEffect(() => {
    if (!autoAccept || readOnly) {
      return;
    }

    const deadline = Date.now() + autoAcceptDelayMs;
    const interval = setInterval(() => {
      const remaining = Math.max(0, deadline - Date.now());
      setCountdownMs(remaining);
      if (remaining === 0) {
        clearInterval(interval);
        onAccept();
      }
    }, 100);

    interval.unref?.();
    return () => clearInterval(interval);
  }, [autoAccept, autoAcceptDelayMs, onAccept, readOnly]);

  useInput((input, key) => {
    if (key.upArrow) {
      setScrollOffset((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setScrollOffset((current) => Math.min(maxScroll, current + 1));
      return;
    }
    if (input === 'v') {
      setShowFullFile((current) => !current);
      setScrollOffset(0);
      return;
    }

    if (readOnly) {
      if (key.escape || key.return || input === 'q') {
        onClose?.();
      }
      return;
    }

    if (input === 'n') {
      onReject();
      return;
    }
    if (input === 'a') {
      onAcceptAll?.();
      onAccept();
      return;
    }
    if (input === 'y' || key.return) {
      onAccept();
      return;
    }
    if (key.escape) {
      onReject();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={readOnly ? 'gray' : 'cyan'} paddingX={1} marginTop={1}>
      <Box justifyContent="space-between">
        <Text bold>{formatFilePath(result)}</Text>
        <Text color="gray">{formatStats(result)}</Text>
      </Box>
      <Text color="gray">{readOnly ? 'Read-only diff history' : 'Review the proposed file change before it is written.'}</Text>

      {effectiveMode === 'sideBySide' ? (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Box width={columnWidth}>
              <Text color="red" bold>BEFORE</Text>
            </Box>
            <Text color="gray">│</Text>
            <Box width={columnWidth}>
              <Text color="green" bold>AFTER</Text>
            </Box>
          </Box>
          {sideBySideRows
            .slice(scrollOffset, scrollOffset + MAX_VISIBLE_LINES)
            .map((row, index) => (
              row.kind === 'header' ? (
                <Text key={`row-${scrollOffset + index}`} color="gray">
                  {row.text}
                </Text>
              ) : (
                <Box key={`row-${scrollOffset + index}`}>
                  {renderSideBySideCell(row.left, 'left', columnWidth)}
                  <Text color="gray">│</Text>
                  {renderSideBySideCell(row.right, 'right', columnWidth)}
                </Box>
              )
            ))}
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {unifiedRows
            .slice(scrollOffset, scrollOffset + MAX_VISIBLE_LINES)
            .map((row, index) => (
              <Text key={`u-${scrollOffset + index}`} color={row.color} dimColor={row.color === 'dim'}>
                {row.text}
              </Text>
            ))}
        </Box>
      )}

      {totalLines > MAX_VISIBLE_LINES ? (
        <Text color="gray">{`scroll indicator: line ${scrollOffset + 1}-${Math.min(scrollOffset + MAX_VISIBLE_LINES, totalLines)} of ${totalLines}`}</Text>
      ) : null}

      {readOnly ? (
        <Text color="gray">Close [Esc]   View full file [v]</Text>
      ) : autoAccept ? (
        <Text color="yellow">{`Auto-accepting in ${Math.max(0, Math.ceil(countdownMs / 1000))}s... [n to cancel]`}</Text>
      ) : (
        <Text color="gray">Accept [y]   Reject [n]   Accept all remaining [a]   View full file [v]</Text>
      )}
    </Box>
  );
}

function renderSideBySideCell(
  cell: SideBySideCell | undefined,
  side: 'left' | 'right',
  columnWidth: number,
): React.ReactNode {
  const lineNumberWidth = 4;
  const contentWidth = Math.max(8, columnWidth - lineNumberWidth - 3);
  const lineNumber = side === 'left' ? cell?.oldLineNumber : cell?.newLineNumber;
  const visibleText = cell?.text.length ? cell.text : ' ';
  const tone = cell?.color === 'dim' ? 'gray' : cell?.color ?? 'gray';
  const highlightedTone = cell?.backgroundColor === 'green'
    ? 'black'
    : cell?.backgroundColor === 'red'
      ? 'white'
      : tone;

  return (
    <Box width={columnWidth}>
      {side === 'left' ? (
        <>
          <Box width={lineNumberWidth} justifyContent="flex-end">
            <Text color="gray">{lineNumber ?? ''}</Text>
          </Box>
          <Text> </Text>
          <Text color={highlightedTone} backgroundColor={cell?.backgroundColor}>
            {cell?.marker ?? ' '}
          </Text>
          <Box width={contentWidth}>
            <Text
              color={highlightedTone}
              backgroundColor={cell?.backgroundColor}
              dimColor={cell?.color === 'dim'}
              wrap="truncate-end"
            >
              {visibleText}
            </Text>
          </Box>
        </>
      ) : (
        <>
          <Text color={highlightedTone} backgroundColor={cell?.backgroundColor}>
            {cell?.marker ?? ' '}
          </Text>
          <Box width={contentWidth}>
            <Text
              color={highlightedTone}
              backgroundColor={cell?.backgroundColor}
              dimColor={cell?.color === 'dim'}
              wrap="truncate-end"
            >
              {visibleText}
            </Text>
          </Box>
          <Text> </Text>
          <Box width={lineNumberWidth} justifyContent="flex-end">
            <Text color="gray">{lineNumber ?? ''}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}

function buildUnifiedRows(result: DiffResult): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  for (const hunk of result.hunks) {
    rows.push({
      text: formatHunkHeader(hunk),
      color: 'white',
      kind: 'meta',
    });
    rows.push(
      ...hunk.lines.map((line) => ({
        ...formatDiffLine(line),
        kind: 'content' as const,
      })),
    );
  }
  return rows;
}

function buildFullUnifiedRows(result: DiffResult): UnifiedRow[] {
  const beforeLines = splitPreservingLineCount(result.before);
  const afterLines = splitPreservingLineCount(result.after);
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const rows: UnifiedRow[] = [];

  for (let index = 0; index < maxLines; index++) {
    const before = beforeLines[index];
    const after = afterLines[index];

    if (before === after) {
      rows.push({
        text: ` ${after ?? ''}`,
        color: 'dim',
        kind: 'content',
      });
      continue;
    }

    if (before !== undefined) {
      rows.push({
        text: `-${before}`,
        color: 'red',
        kind: 'content',
      });
    }
    if (after !== undefined) {
      rows.push({
        text: `+${after}`,
        color: 'green',
        kind: 'content',
      });
    }
  }

  return rows;
}

function buildSideBySideRows(result: DiffResult): SideBySideRow[] {
  const rows: SideBySideRow[] = [];

  for (const hunk of result.hunks) {
    rows.push({ kind: 'header', text: formatHunkHeader(hunk) });

    let pendingRemoved: SideBySideCell[] = [];
    let pendingAdded: SideBySideCell[] = [];

    const flushChangedBlock = () => {
      const pairCount = Math.max(pendingRemoved.length, pendingAdded.length);
      for (let index = 0; index < pairCount; index++) {
        rows.push({
          kind: 'pair',
          left: pendingRemoved[index],
          right: pendingAdded[index],
        });
      }
      pendingRemoved = [];
      pendingAdded = [];
    };

    for (const line of hunk.lines) {
      if (line.type === 'unchanged') {
        flushChangedBlock();
        const cell = toSideBySideCell(line);
        rows.push({
          kind: 'pair',
          left: cell,
          right: cell,
        });
        continue;
      }

      if (line.type === 'removed') {
        pendingRemoved.push(toSideBySideCell(line));
        continue;
      }

      pendingAdded.push(toSideBySideCell(line));
    }

    flushChangedBlock();
  }

  return rows;
}

function buildFullSideBySideRows(result: DiffResult): SideBySideRow[] {
  const beforeLines = splitPreservingLineCount(result.before);
  const afterLines = splitPreservingLineCount(result.after);
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const rows: SideBySideRow[] = [];

  for (let index = 0; index < maxLines; index++) {
    const before = beforeLines[index];
    const after = afterLines[index];

    rows.push({
      kind: 'pair',
      left: before === undefined
        ? undefined
        : {
            text: before,
            color: before === after ? 'dim' : 'red',
            backgroundColor: before === after ? undefined : 'red',
            marker: before === after ? ' ' : '-',
            oldLineNumber: index + 1,
          },
      right: after === undefined
        ? undefined
        : {
            text: after,
            color: before === after ? 'dim' : 'green',
            backgroundColor: before === after ? undefined : 'green',
            marker: before === after ? ' ' : '+',
            newLineNumber: index + 1,
          },
    });
  }

  return rows;
}

function splitPreservingLineCount(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const normalized = text.endsWith('\n') ? text.slice(0, -1) : text;
  return normalized.length === 0 ? [''] : normalized.split('\n');
}

function toSideBySideCell(line: DiffResult['hunks'][number]['lines'][number]): SideBySideCell {
  if (line.type === 'added') {
    return {
      text: line.content,
      color: 'green',
      backgroundColor: 'green',
      marker: '+',
      newLineNumber: line.newLineNumber,
    };
  }

  if (line.type === 'removed') {
    return {
      text: line.content,
      color: 'red',
      backgroundColor: 'red',
      marker: '-',
      oldLineNumber: line.oldLineNumber,
    };
  }

  return {
    text: line.content,
    color: 'dim',
    marker: ' ',
    oldLineNumber: line.oldLineNumber,
    newLineNumber: line.newLineNumber,
  };
}
