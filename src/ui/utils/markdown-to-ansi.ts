/**
 * System 3 – Custom Markdown-to-ANSI Renderer
 *
 * Converts markdown text to arrays of ANSI-escape-coded strings.
 * These strings are passed to bare <Text> components in Ink so Ink
 * measures visible width correctly (string-width strips ANSI) while
 * the terminal interprets the escape sequences natively.
 *
 * Pipeline:  raw markdown  →  block tokenizer  →  inline tokenizer
 *            →  ANSI code injection  →  string[]
 */

// ---------------------------------------------------------------------------
// 1. Low-level ANSI helpers
// ---------------------------------------------------------------------------

const esc = (code: string | number) => `\x1b[${code}m`;

const A = {
  reset: esc(0),
  bold:      (s: string) => `${esc(1)}${s}${esc(22)}`,
  dim:       (s: string) => `${esc(2)}${s}${esc(22)}`,
  italic:    (s: string) => `${esc(3)}${s}${esc(23)}`,
  underline: (s: string) => `${esc(4)}${s}${esc(24)}`,
  // 4-bit foreground helpers
  fg4: (n: number, s: string) => `${esc(n)}${s}${esc(39)}`,
  // Truecolor
  fg24: (r: number, g: number, b: number, s: string) =>
    `${esc(`38;2;${r};${g};${b}`)}${s}${esc(39)}`,
  bg24: (r: number, g: number, b: number, s: string) =>
    `${esc(`48;2;${r};${g};${b}`)}${s}${esc(49)}`,
} as const;

// ---------------------------------------------------------------------------
// 2. Semantic color palette  (mirrors theme.ts intent but as raw ANSI)
// ---------------------------------------------------------------------------

/** theme brand: #e08a68 */
const brand = (s: string) => A.fg24(224, 138, 104, s);
/** brightBlue */
const primary = (s: string) => A.fg4(94, s);
/** cyan */
const accent = (s: string) => A.fg4(36, s);
/** gray */
const muted = (s: string) => A.fg4(90, s);

const C = {
  // Headings
  h1: (s: string) => A.bold(A.underline(brand(s))),
  h2: (s: string) => A.bold(primary(s)),
  h3: (s: string) => A.bold(accent(s)),
  // Inline
  bold:       (s: string) => A.bold(s),
  italic:     (s: string) => A.italic(s),
  /** inline `code` – VS Code blue #569cd6 */
  inlineCode: (s: string) => A.fg24(86, 156, 214, s),
  // Structure
  muted,
  hr:   (s: string) => muted(s),
  // Code block
  codeFence: (s: string) => A.dim(muted(s)),
  codeBody:  (s: string) => A.fg4(96, s),    // bright cyan
  // Table
  tableSep: (s: string) => muted(s),
} as const;

// ---------------------------------------------------------------------------
// 3. Inline renderer
//    Handles **bold**, *italic*, `code`, __bold__, _italic_
//    Unmatched markers pass through as literal text (safe during streaming).
// ---------------------------------------------------------------------------

export function renderInline(text: string): string {
  // Order matters: match ** before * to avoid false positives.
  const re =
    /\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|`([^`\n]+?)`|__([^_\n]+?)__|_([^_\n]+?)_/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    out += text.slice(last, m.index);
    if (m[1] !== undefined) out += C.bold(m[1]);        // **bold**
    else if (m[2] !== undefined) out += C.italic(m[2]); // *italic*
    else if (m[3] !== undefined) out += C.inlineCode(m[3]); // `code`
    else if (m[4] !== undefined) out += C.bold(m[4]);   // __bold__
    else if (m[5] !== undefined) out += C.italic(m[5]); // _italic_
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  return out;
}

// ---------------------------------------------------------------------------
// 4. Block renderer  →  string[]
// ---------------------------------------------------------------------------

export function renderMarkdown(text: string): string[] {
  const raw = text.split('\n');
  const out: string[] = [];
  let inCode = false;

  for (const line of raw) {
    // ── Inside a fenced code block ──────────────────────────────────────────
    if (inCode) {
      if (line.startsWith('```')) {
        out.push(C.codeFence('╰───'));
        inCode = false;
      } else {
        out.push(C.codeBody(line || ' '));
      }
      continue;
    }

    // ── Opening fence ────────────────────────────────────────────────────────
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      out.push(C.codeFence(`╭── ${lang || 'code'}`));
      inCode = true;
      continue;
    }

    const t = line.trim();

    // ── Blank ────────────────────────────────────────────────────────────────
    if (t === '') {
      out.push('');
      continue;
    }

    // ── Headings ─────────────────────────────────────────────────────────────
    {
      const h3 = t.match(/^###\s+(.+)/);
      const h2 = t.match(/^##\s+(.+)/);
      const h1 = t.match(/^#\s+(.+)/);
      if (h1) { out.push(C.h1(renderInline(h1[1]))); continue; }
      if (h2) { out.push(C.h2(renderInline(h2[1]))); continue; }
      if (h3) { out.push(C.h3(renderInline(h3[1]))); continue; }
    }

    // ── Horizontal rule ──────────────────────────────────────────────────────
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      out.push(C.hr('─'.repeat(56)));
      continue;
    }

    // ── Unordered list ───────────────────────────────────────────────────────
    if (/^[*+\-] /.test(t)) {
      out.push(`${C.muted('•')} ${renderInline(t.slice(2))}`);
      continue;
    }

    // ── Ordered list ─────────────────────────────────────────────────────────
    const olm = t.match(/^(\d+)\. (.+)/);
    if (olm) {
      out.push(`${C.muted(`${olm[1]}.`)} ${renderInline(olm[2])}`);
      continue;
    }

    // ── Table separator  |---|---| ───────────────────────────────────────────
    if (/^\|[\s\-:|]+\|$/.test(t)) {
      out.push(C.tableSep('─'.repeat(40)));
      continue;
    }

    // ── Table data row ───────────────────────────────────────────────────────
    if (t.startsWith('|') && t.endsWith('|')) {
      const cells = t.split('|').slice(1, -1).map((c) => renderInline(c.trim()));
      out.push(cells.join('  '));
      continue;
    }

    // ── Regular paragraph line ───────────────────────────────────────────────
    out.push(renderInline(line));
  }

  return out;
}
