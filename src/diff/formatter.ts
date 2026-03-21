import { basename, isAbsolute, relative } from 'path';
import type { DiffHunk, DiffLine, DiffResult } from '../shared/types.ts';

export interface FormattedLine {
  text: string;
  color: 'green' | 'red' | 'dim' | 'white';
  backgroundColor?: 'green' | 'red';
  oldLineNumber?: number;
  newLineNumber?: number;
  kind: 'meta' | 'content';
}

interface MetaLine {
  kind: 'meta';
  text: string;
  color: 'white';
}

export function formatHunkHeader(hunk: DiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

export function formatDiffLine(line: DiffLine): { text: string; color: 'green' | 'red' | 'dim' | 'white' } {
  if (line.type === 'added') {
    return { text: `+${line.content}`, color: 'green' };
  }
  if (line.type === 'removed') {
    return { text: `-${line.content}`, color: 'red' };
  }
  return { text: ` ${line.content}`, color: 'dim' };
}

export function formatStats(result: DiffResult): string {
  return `+${result.stats.added} -${result.stats.removed} lines`;
}

export function formatFilePath(result: DiffResult): string {
  const displayPath = isAbsolute(result.filePath)
    ? relative(process.cwd(), result.filePath) || basename(result.filePath)
    : result.filePath;
  return `~ ${displayPath}`;
}

export function splitIntoColumns(
  result: DiffResult,
  terminalWidth: number,
): { left: FormattedLine[]; right: FormattedLine[] } {
  const lines = flattenHunks(result);
  const left: FormattedLine[] = [];
  const right: FormattedLine[] = [];
  const columnWidth = Math.max(24, Math.floor((terminalWidth - 1) / 2));

  for (const line of lines) {
    if ('kind' in line) {
      left.push({
        ...line,
        text: truncate(line.text, columnWidth),
      });
      right.push({
        ...line,
        text: truncate(line.text, columnWidth),
      });
      continue;
    }

    if (line.type === 'added') {
      left.push(blankColumnLine(columnWidth));
      right.push({
        kind: 'content',
        color: 'green',
        backgroundColor: 'green',
        oldLineNumber: undefined,
        newLineNumber: line.newLineNumber,
        text: truncate(line.content, columnWidth),
      });
      continue;
    }

    if (line.type === 'removed') {
      left.push({
        kind: 'content',
        color: 'red',
        backgroundColor: 'red',
        oldLineNumber: line.oldLineNumber,
        newLineNumber: undefined,
        text: truncate(line.content, columnWidth),
      });
      right.push(blankColumnLine(columnWidth));
      continue;
    }

    left.push({
      kind: 'content',
      color: 'dim',
      oldLineNumber: line.oldLineNumber,
      newLineNumber: line.newLineNumber,
      text: truncate(line.content, columnWidth),
    });
    right.push({
      kind: 'content',
      color: 'dim',
      oldLineNumber: line.oldLineNumber,
      newLineNumber: line.newLineNumber,
      text: truncate(line.content, columnWidth),
    });
  }

  return { left, right };
}

function flattenHunks(result: DiffResult): Array<MetaLine | DiffLine> {
  const lines: Array<MetaLine | DiffLine> = [];

  for (const hunk of result.hunks) {
    lines.push({
      kind: 'meta',
      color: 'white',
      text: formatHunkHeader(hunk),
    });
    lines.push(...hunk.lines);
  }

  return lines;
}

function blankColumnLine(width: number): FormattedLine {
  return {
    kind: 'content',
    color: 'dim',
    text: ''.padEnd(Math.max(0, width), ' '),
  };
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}
