import { useMemo, useState } from 'react';
import type { Key } from 'ink';
import { Cursor } from '../cursor.ts';
import { useTerminalSize } from './use-terminal-size.ts';

interface UseTextInputOptions {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  multiline?: boolean;
}

export function useTextInput({
  value,
  onChange,
  onSubmit,
  multiline = true,
}: UseTextInputOptions): {
  onInput: (input: string, key: Key) => void;
  renderedValue: string;
  offset: number;
  setOffset: (offset: number) => void;
} {
  const { columns } = useTerminalSize();
  const [offset, setOffset] = useState(value.length);
  const cursor = useMemo(
    () => Cursor.fromText(value, columns, offset),
    [columns, offset, value],
  );

  const onInput = (input: string, key: Key) => {
    let nextCursor = cursor;

    if (key.leftArrow) {
      nextCursor = cursor.moveLeft();
    } else if (key.rightArrow) {
      nextCursor = cursor.moveRight();
    } else if (key.ctrl && input === 'a') {
      nextCursor = cursor.moveToStart();
    } else if (key.ctrl && input === 'e') {
      nextCursor = cursor.moveToEnd();
    } else if (key.ctrl && input === 'b') {
      nextCursor = cursor.moveWordLeft();
    } else if (key.ctrl && input === 'f') {
      nextCursor = cursor.moveWordRight();
    } else if (key.backspace || key.delete) {
      nextCursor = cursor.deleteBack();
      onChange(nextCursor.text);
    } else if (key.return) {
      if (multiline && key.shift) {
        nextCursor = cursor.insert('\n');
        onChange(nextCursor.text);
      } else {
        onSubmit(cursor.text);
      }
    } else if (!key.ctrl && !key.meta && input) {
      nextCursor = cursor.insert(input);
      onChange(nextCursor.text);
    }

    setOffset(nextCursor.offset);
  };

  return {
    onInput,
    renderedValue: cursor.render('▌'),
    offset,
    setOffset,
  };
}
