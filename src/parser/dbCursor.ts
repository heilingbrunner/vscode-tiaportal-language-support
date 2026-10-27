export class DbParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = 'DbParseError';
  }
}

const WORD = /[A-Za-z_][A-Za-z0-9_]*/y;
// the lookbehind keeps the scan linear: a long run of word characters is tried from its start only
const PRAGMA_ENTRY = /(?<![A-Za-z0-9_])([A-Za-z0-9_]+)\s*:=\s*'([^']*)'/g;

/**
 * Character cursor over TIA source text (DB / UDT).
 * Whitespace, `(* *)` and `//` comments are skipped by every method except the `*Inline`
 * and `trailingComment` helpers, which stay on the current line.
 */
export class Cursor {
  private pos: number;

  constructor(private readonly src: string) {
    this.pos = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  }

  fail(message: string): never {
    let line = 1;
    for (let i = 0; i < this.pos && i < this.src.length; i++) {
      if (this.src.charCodeAt(i) === 10) {
        line++;
      }
    }
    throw new DbParseError(message, line);
  }

  skipWs(): void {
    const { src } = this;
    for (;;) {
      const c = src[this.pos];
      if (c === undefined) {
        return;
      }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        this.pos++;
      } else if (c === '/' && src[this.pos + 1] === '/') {
        const end = src.indexOf('\n', this.pos);
        this.pos = end < 0 ? src.length : end;
      } else if (c === '(' && src[this.pos + 1] === '*') {
        const end = src.indexOf('*)', this.pos + 2);
        this.pos = end < 0 ? src.length : end + 2;
      } else {
        return;
      }
    }
  }

  /** Next significant character, or `''` at the end of the text. */
  peek(): string {
    this.skipWs();
    return this.src[this.pos] ?? '';
  }

  peekWord(): string {
    this.skipWs();
    WORD.lastIndex = this.pos;
    return WORD.exec(this.src)?.[0] ?? '';
  }

  word(): string {
    const word = this.peekWord();
    if (!word) {
      this.fail('identifier expected');
    }
    this.pos += word.length;
    return word;
  }

  /** Consumes `expected` (compared case-insensitively) when it is the next word. */
  eatWord(expected: string): boolean {
    if (this.peekWord().toUpperCase() !== expected) {
      return false;
    }
    this.pos += expected.length;
    return true;
  }

  eat(text: string): boolean {
    this.skipWs();
    if (!this.src.startsWith(text, this.pos)) {
      return false;
    }
    this.pos += text.length;
    return true;
  }

  expect(text: string): void {
    if (!this.eat(text)) {
      this.fail(`'${text}' expected`);
    }
  }

  /** Like `eat`, but only skips blanks on the current line. */
  eatInline(text: string): boolean {
    while (this.src[this.pos] === ' ' || this.src[this.pos] === '\t') {
      this.pos++;
    }
    if (!this.src.startsWith(text, this.pos)) {
      return false;
    }
    this.pos += text.length;
    return true;
  }

  /** Like `eatWord`, but only looks on the current line (for modifiers such as `VAR RETAIN`). */
  eatInlineWord(expected: string): boolean {
    let p = this.pos;
    while (this.src[p] === ' ' || this.src[p] === '\t') {
      p++;
    }
    WORD.lastIndex = p;
    const word = WORD.exec(this.src)?.[0] ?? '';
    if (word.toUpperCase() !== expected) {
      return false;
    }
    this.pos = p + word.length;
    return true;
  }

  /** Everything after the current position, unparsed. */
  remainder(): string {
    return this.src.slice(this.pos);
  }

  quoted(): string {
    this.skipWs();
    if (this.src[this.pos] !== '"') {
      this.fail('quoted name expected');
    }
    const end = this.src.indexOf('"', this.pos + 1);
    if (end < 0) {
      this.fail('unterminated quoted name');
    }
    const value = this.src.slice(this.pos + 1, end);
    this.pos = end + 1;
    return value;
  }

  /** A plain identifier or a `"quoted name"`. */
  name(): string {
    return this.peek() === '"' ? this.quoted() : this.word();
  }

  /** Parses an optional `{ key := 'value'; ... }` block into lower-cased keys. */
  pragma(): Record<string, string> {
    const result: Record<string, string> = Object.create(null) as Record<string, string>;
    this.skipWs();
    if (this.src[this.pos] !== '{') {
      return result;
    }
    const end = this.src.indexOf('}', this.pos);
    if (end < 0) {
      this.fail("'}' expected");
    }
    const inner = this.src.slice(this.pos + 1, end);
    this.pos = end + 1;
    for (const match of inner.matchAll(PRAGMA_ENTRY)) {
      result[(match[1] ?? '').toLowerCase()] = match[2] ?? '';
    }
    return result;
  }

  /** Rest of the current line, trimmed; the line break is not consumed. */
  restOfLine(): string {
    const end = this.src.indexOf('\n', this.pos);
    const stop = end < 0 ? this.src.length : end;
    const text = this.src.slice(this.pos, stop).replace(/\r$/, '').trim();
    this.pos = stop;
    return text;
  }

  /** A `// ...` or `(* ... *)` comment on the current line, without its delimiters. */
  trailingComment(): string {
    let p = this.pos;
    while (this.src[p] === ' ' || this.src[p] === '\t') {
      p++;
    }
    if (this.src.startsWith('//', p)) {
      this.pos = p + 2;
      return this.restOfLine();
    }
    if (this.src.startsWith('(*', p)) {
      const end = this.src.indexOf('*)', p + 2);
      const lineEnd = this.src.indexOf('\n', p);
      if (end >= 0 && (lineEnd < 0 || end < lineEnd)) {
        this.pos = end + 2;
        return this.src.slice(p + 2, end).trim();
      }
    }
    return '';
  }

  /** Text up to the closing `close`, balanced against `open`; the opening char is already consumed. */
  readBalanced(open: string, close: string): string {
    const start = this.pos;
    let depth = 1;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === '"' || c === "'") {
        this.pos++;
        while (this.pos < this.src.length && this.src[this.pos] !== c) {
          // `$` escapes the next character (`$'` is an apostrophe inside an SCL string)
          this.pos += this.src[this.pos] === '$' && c === "'" ? 2 : 1;
        }
      } else if (c === open) {
        depth++;
      } else if (c === close && --depth === 0) {
        const text = this.src.slice(start, this.pos);
        this.pos++;
        return text;
      }
      this.pos++;
    }
    return this.fail(`'${close}' expected`);
  }

  /** An initial value: everything up to the next `;` outside brackets, strings and comments. */
  initText(): string {
    this.skipWs();
    const start = this.pos;
    const { src } = this;
    let depth = 0;
    while (this.pos < src.length) {
      const c = src[this.pos];
      if (c === "'") {
        this.skipString();
        continue;
      }
      if (c === '/' && src[this.pos + 1] === '/') {
        const end = src.indexOf('\n', this.pos);
        this.pos = end < 0 ? src.length : end;
        continue;
      }
      if (c === '(' && src[this.pos + 1] === '*') {
        const end = src.indexOf('*)', this.pos + 2);
        this.pos = end < 0 ? src.length : end + 2;
        continue;
      }
      if (c === '[' || c === '(') {
        depth++;
      } else if (c === ']' || c === ')') {
        depth--;
      } else if (c === ';' && depth <= 0) {
        return src.slice(start, this.pos).trim();
      }
      this.pos++;
    }
    return this.fail("';' expected after initial value");
  }

  /** Skips a `'...'` literal (a doubled quote is an escaped quote). */
  private skipString(): void {
    this.pos++;
    while (this.pos < this.src.length) {
      if (this.src[this.pos] === '$') {
        this.pos += 2;
        continue;
      }
      if (this.src[this.pos] === "'") {
        if (this.src[this.pos + 1] === "'") {
          this.pos += 2;
          continue;
        }
        this.pos++;
        return;
      }
      this.pos++;
    }
  }
}
