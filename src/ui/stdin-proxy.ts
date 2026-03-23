/**
 * useBracketedPaste — intercepts bracketed paste sequences at the raw stdin
 * level, before Ink's parseKeypress strips the leading \x1b.
 *
 * Strategy: prepend a 'readable' listener on process.stdin so it runs before
 * Ink's own listener. Inside it we consume the raw chunks, detect
 * \x1b[200~...\x1b[201~ paste sequences, accumulate them across multiple
 * reads, and unshift all non-paste bytes back so Ink reads them normally.
 * When a complete paste is detected, onPaste is called with the content.
 */

import { useEffect, useRef } from 'react';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export function useBracketedPaste(
  onPaste: (content: string) => void,
  options: { isActive?: boolean } = {},
): void {
  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;
  const isActive = options.isActive ?? true;

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let pasteBuffer: string | null = null;
    let inHandler = false;

    const handler = () => {
      if (inHandler) return;
      inHandler = true;

      const normalChunks: string[] = [];
      let chunk: string | Buffer | null;

      // eslint-disable-next-line no-cond-assign
      while ((chunk = (process.stdin as NodeJS.ReadStream).read()) !== null) {
        const s = typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');

        let remaining = s;

        while (remaining.length > 0) {
          if (pasteBuffer !== null) {
            // Inside paste — look for end marker
            const endIdx = remaining.indexOf(PASTE_END);
            if (endIdx < 0) {
              pasteBuffer += remaining;
              remaining = '';
            } else {
              pasteBuffer += remaining.slice(0, endIdx);
              remaining = remaining.slice(endIdx + PASTE_END.length);
              // Complete paste — fire callback
              const content = pasteBuffer;
              pasteBuffer = null;
              if (content.length > 0) {
                onPasteRef.current(content);
              }
            }
          } else {
            // Normal mode — look for start marker
            const startIdx = remaining.indexOf(PASTE_START);
            if (startIdx < 0) {
              normalChunks.push(remaining);
              remaining = '';
            } else {
              // Everything before the marker is normal input
              if (startIdx > 0) normalChunks.push(remaining.slice(0, startIdx));
              remaining = remaining.slice(startIdx + PASTE_START.length);
              pasteBuffer = '';
            }
          }
        }
      }

      // Put normal (non-paste) bytes back so Ink reads them
      if (normalChunks.length > 0) {
        (process.stdin as NodeJS.ReadStream).unshift(normalChunks.join(''));
      }

      inHandler = false;
    };

    process.stdin.prependListener('readable', handler);
    return () => {
      process.stdin.removeListener('readable', handler);
    };
  }, [isActive]);
}
