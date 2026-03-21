export interface LoadedContextFile {
  path: string;
  text: string;
  lineCount: number;
  tokenCount: number;
}

export function createLoadedContextFile(path: string, text: string): LoadedContextFile | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  return {
    path,
    text,
    lineCount: trimmed.split('\n').length,
    tokenCount: estimateTokenCount(trimmed),
  };
}

export function estimateTokenCount(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}]+|[^\s]/gu);
  return matches?.length ?? 0;
}
