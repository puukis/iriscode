import { diffLines, structuredPatch } from 'diff';
import type { DiffHunk, DiffLine, DiffResult, DiffStats } from '../shared/types.ts';

const CONTEXT_LINES = 3;

export function computeDiff(before: string, after: string, filePath: string): DiffResult {
  const normalizedBefore = before ?? '';
  const normalizedAfter = after ?? '';
  const stats = computeStats(normalizedBefore, normalizedAfter);
  const isEmpty = normalizedBefore === normalizedAfter;

  if (isEmpty) {
    return {
      filePath,
      before: normalizedBefore,
      after: normalizedAfter,
      hunks: [],
      stats,
      isEmpty: true,
    };
  }

  const patch = structuredPatch(filePath, filePath, normalizedBefore, normalizedAfter, '', '', {
    context: CONTEXT_LINES,
  });

  return {
    filePath,
    before: normalizedBefore,
    after: normalizedAfter,
    hunks: patch.hunks.map(convertHunk),
    stats,
    isEmpty: false,
  };
}

function computeStats(before: string, after: string): DiffStats {
  const changes = diffLines(before, after);
  const stats: DiffStats = {
    added: 0,
    removed: 0,
    unchanged: 0,
  };

  for (const change of changes) {
    const lineCount = countLines(change.value);
    if (change.added) {
      stats.added += lineCount;
    } else if (change.removed) {
      stats.removed += lineCount;
    } else {
      stats.unchanged += lineCount;
    }
  }

  return stats;
}

function convertHunk(hunk: {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}): DiffHunk {
  let oldLineNumber = hunk.oldStart;
  let newLineNumber = hunk.newStart;
  const lines: DiffLine[] = [];

  for (const rawLine of hunk.lines) {
    if (rawLine.startsWith('\\')) {
      continue;
    }

    const prefix = rawLine[0] ?? ' ';
    const content = stripTrailingNewline(rawLine.slice(1));

    if (prefix === '+') {
      lines.push({
        type: 'added',
        content,
        newLineNumber,
      });
      newLineNumber += 1;
      continue;
    }

    if (prefix === '-') {
      lines.push({
        type: 'removed',
        content,
        oldLineNumber,
      });
      oldLineNumber += 1;
      continue;
    }

    lines.push({
      type: 'unchanged',
      content,
      oldLineNumber,
      newLineNumber,
    });
    oldLineNumber += 1;
    newLineNumber += 1;
  }

  return {
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines,
  };
}

function stripTrailingNewline(value: string): string {
  if (value.endsWith('\n')) {
    return value.slice(0, -1);
  }
  return value;
}

function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }

  const normalized = value.endsWith('\n') ? value.slice(0, -1) : value;
  if (normalized.length === 0) {
    return 1;
  }

  return normalized.split('\n').length;
}
