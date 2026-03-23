export class Cursor {
  private readonly internalText: string;
  private readonly internalOffset: number;
  private readonly columns: number;

  private constructor(text: string, columns: number, offset: number) {
    this.internalText = text;
    this.columns = Math.max(1, columns);
    this.internalOffset = clamp(offset, 0, text.length);
  }

  static fromText(text: string, columns: number, offset: number): Cursor {
    return new Cursor(text, columns, offset);
  }

  render(cursorChar: string, mask?: string, invert = false): string {
    const source = mask ? mask.repeat(this.internalText.length).slice(0, this.internalText.length) : this.internalText;
    const safeCursor = cursorChar || '▌';
    const before = source.slice(0, this.internalOffset);
    const current = source[this.internalOffset] ?? ' ';
    const after = source.slice(Math.min(this.internalOffset + 1, source.length));
    return invert
      ? `${before}${current || ' '}${safeCursor}${after}`
      : `${before}${safeCursor}${after}`;
  }

  moveLeft(): Cursor {
    return new Cursor(this.internalText, this.columns, this.internalOffset - 1);
  }

  moveRight(): Cursor {
    return new Cursor(this.internalText, this.columns, this.internalOffset + 1);
  }

  moveWordLeft(): Cursor {
    let nextOffset = this.internalOffset;
    while (nextOffset > 0 && /\s/.test(this.internalText[nextOffset - 1] ?? '')) {
      nextOffset -= 1;
    }
    while (nextOffset > 0 && !/\s/.test(this.internalText[nextOffset - 1] ?? '')) {
      nextOffset -= 1;
    }
    return new Cursor(this.internalText, this.columns, nextOffset);
  }

  moveWordRight(): Cursor {
    let nextOffset = this.internalOffset;
    while (nextOffset < this.internalText.length && /\s/.test(this.internalText[nextOffset] ?? '')) {
      nextOffset += 1;
    }
    while (nextOffset < this.internalText.length && !/\s/.test(this.internalText[nextOffset] ?? '')) {
      nextOffset += 1;
    }
    return new Cursor(this.internalText, this.columns, nextOffset);
  }

  moveToStart(): Cursor {
    return new Cursor(this.internalText, this.columns, 0);
  }

  moveToEnd(): Cursor {
    return new Cursor(this.internalText, this.columns, this.internalText.length);
  }

  insert(char: string): Cursor {
    const nextText = `${this.internalText.slice(0, this.internalOffset)}${char}${this.internalText.slice(this.internalOffset)}`;
    return new Cursor(nextText, this.columns, this.internalOffset + char.length);
  }

  deleteBack(): Cursor {
    if (this.internalOffset === 0) {
      return this;
    }
    const nextText = `${this.internalText.slice(0, this.internalOffset - 1)}${this.internalText.slice(this.internalOffset)}`;
    return new Cursor(nextText, this.columns, this.internalOffset - 1);
  }

  deleteForward(): Cursor {
    if (this.internalOffset >= this.internalText.length) {
      return this;
    }
    const nextText = `${this.internalText.slice(0, this.internalOffset)}${this.internalText.slice(this.internalOffset + 1)}`;
    return new Cursor(nextText, this.columns, this.internalOffset);
  }

  get text(): string {
    return this.internalText;
  }

  get offset(): number {
    return this.internalOffset;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
