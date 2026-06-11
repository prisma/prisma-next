export type TokenKind =
  | 'Ident'
  | 'StringLiteral'
  | 'NumberLiteral'
  | 'At'
  | 'DoubleAt'
  | 'LBrace'
  | 'RBrace'
  | 'LParen'
  | 'RParen'
  | 'LBracket'
  | 'RBracket'
  | 'Equals'
  | 'Question'
  | 'Dot'
  | 'Comma'
  | 'Colon'
  | 'Whitespace'
  | 'Newline'
  | 'Comment'
  | 'Invalid'
  | 'Eof';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

export class Tokenizer {
  readonly #source: string;
  #pos: number;
  readonly #buffer: Token[];

  constructor(source: string) {
    this.#source = source;
    this.#pos = 0;
    this.#buffer = [];
  }

  next(): Token {
    const next = this.#buffer.shift();
    if (next) {
      return next;
    }
    return this.#scanNext();
  }

  peek(offset = 0): Token {
    if (offset > this.#buffer.length) {
      const last = this.#buffer.at(-1);
      if (last?.kind === 'Eof') {
        return last;
      }
    }

    const token = this.#buffer[offset];
    if (token) {
      return token;
    }

    while (this.#buffer.length <= offset) {
      const token = this.#scanNext();
      if (token.kind === 'Eof') {
        return token;
      }
      this.#buffer.push(token);
    }

    return this.#buffer[offset] as Token;
  }

  #scanNext(): Token {
    const token = scan(this.#source, this.#pos);
    this.#pos += token.text.length;
    return token;
  }
}

function scan(source: string, pos: number): Token {
  if (pos >= source.length) {
    return { kind: 'Eof', text: '' };
  }

  return (
    scanNewline(source, pos) ??
    scanWhitespace(source, pos) ??
    scanComment(source, pos) ??
    scanAt(source, pos) ??
    scanIdent(source, pos) ??
    scanNumber(source, pos) ??
    scanString(source, pos) ??
    scanPunctuation(source, pos) ?? {
      kind: 'Invalid' as const,
      text: readChar(source, pos),
    }
  );
}

function scanNewline(source: string, pos: number): Token | undefined {
  const ch = source.charAt(pos);
  if (ch !== '\r' && ch !== '\n') return undefined;
  if (ch === '\r' && source.charAt(pos + 1) === '\n') {
    return { kind: 'Newline', text: '\r\n' };
  }
  return { kind: 'Newline', text: ch };
}

function scanWhitespace(source: string, pos: number): Token | undefined {
  const ch = source.charAt(pos);
  if (ch !== ' ' && ch !== '\t') return undefined;
  let end = pos + 1;
  while (end < source.length) {
    const c = source.charAt(end);
    if (c !== ' ' && c !== '\t') break;
    end++;
  }
  return { kind: 'Whitespace', text: source.slice(pos, end) };
}

function scanComment(source: string, pos: number): Token | undefined {
  if (source.charAt(pos) !== '/' || source.charAt(pos + 1) !== '/') return undefined;
  let end = pos + 2;
  while (end < source.length) {
    const c = source.charAt(end);
    if (c === '\n' || c === '\r') break;
    end++;
  }
  return { kind: 'Comment', text: source.slice(pos, end) };
}

function scanAt(source: string, pos: number): Token | undefined {
  if (source.charAt(pos) !== '@') return undefined;
  if (source.charAt(pos + 1) === '@') {
    return { kind: 'DoubleAt', text: '@@' };
  }
  return { kind: 'At', text: '@' };
}

function scanIdent(source: string, pos: number): Token | undefined {
  const ch = readChar(source, pos);
  if (!isIdentStart(ch)) return undefined;
  let end = pos + ch.length;
  while (end < source.length) {
    const c = readChar(source, end);
    if (isIdentPart(c)) {
      end += c.length;
    } else {
      break;
    }
  }
  return { kind: 'Ident', text: source.slice(pos, end) };
}

function scanNumber(source: string, pos: number): Token | undefined {
  let end = pos;
  if (source.charAt(end) === '-') {
    if (end + 1 >= source.length || !isDigit(source.charAt(end + 1))) return undefined;
    end++;
  } else if (!isDigit(source.charAt(end))) {
    return undefined;
  }
  end++;
  while (end < source.length && isDigit(source.charAt(end))) {
    end++;
  }
  if (source.charAt(end) === '.' && end + 1 < source.length && isDigit(source.charAt(end + 1))) {
    end++; // consume the dot
    while (end < source.length && isDigit(source.charAt(end))) {
      end++;
    }
  }
  return { kind: 'NumberLiteral', text: source.slice(pos, end) };
}

function scanString(source: string, pos: number): Token | undefined {
  if (source.charAt(pos) !== '"') return undefined;
  let end = pos + 1;
  while (end < source.length) {
    const c = source.charAt(end);
    if (c === '\\' && end + 1 < source.length) {
      end += 2; // skip escape sequence
      continue;
    }
    if (c === '"') {
      end++; // include closing quote
      return { kind: 'StringLiteral', text: source.slice(pos, end) };
    }
    if (c === '\n' || c === '\r') {
      // Unterminated: stop before newline
      return { kind: 'StringLiteral', text: source.slice(pos, end) };
    }
    end++;
  }
  // Unterminated at EOF
  return { kind: 'StringLiteral', text: source.slice(pos, end) };
}

/**
 * Whether a `StringLiteral` token's text is properly closed. `scanString` emits
 * the same `StringLiteral` kind for both well-formed and unterminated strings —
 * it stops at a newline or EOF when no closing quote is found — so callers that
 * need to distinguish the two ask here.
 *
 * Because `scanString` stops at the *first* unescaped `"`, the only quote whose
 * escaping can be in question is the **last character**: the text is terminated
 * iff it opens with `"`, ends with `"`, and that closing `"` is not escaped.
 * Under the `\\`-escapes-the-next-character rule, a `"` is unescaped iff an
 * **even** number of backslashes immediately precede it — each `\\` pair cancels,
 * and an odd run leaves the final `\` escaping the quote. So it suffices to
 * count the trailing backslash run; no full re-scan is needed:
 *
 * - `"ok"`  → 0 backslashes (even) → closing quote stands → terminated
 * - `"a\"`  → 1 backslash  (odd)   → the `"` is escaped     → unterminated
 * - `"a\\"` → 2 backslashes (even) → escaped `\`, real `"`  → terminated
 *
 * A lone `"` (length 1) or a text with no closing `"` is unterminated.
 */
export function isTerminatedStringLiteral(text: string): boolean {
  if (text.length < 2 || text.charAt(0) !== '"' || text.charAt(text.length - 1) !== '"') {
    return false;
  }
  let backslashes = 0;
  for (let i = text.length - 2; i >= 1 && text.charAt(i) === '\\'; i--) {
    backslashes++;
  }
  return backslashes % 2 === 0;
}

function scanPunctuation(source: string, pos: number): Token | undefined {
  const kind = PUNCTUATION[source.charAt(pos)];
  if (kind === undefined) return undefined;
  return { kind, text: source.charAt(pos) };
}

function readChar(source: string, pos: number): string {
  const cp = source.codePointAt(pos);
  return cp !== undefined ? String.fromCodePoint(cp) : '';
}

function isIdentStart(ch: string): boolean {
  return /\p{L}/u.test(ch) || ch === '_';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch) || ch === '-';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

const PUNCTUATION: Record<string, TokenKind> = {
  '{': 'LBrace',
  '}': 'RBrace',
  '(': 'LParen',
  ')': 'RParen',
  '[': 'LBracket',
  ']': 'RBracket',
  '=': 'Equals',
  '?': 'Question',
  '.': 'Dot',
  ',': 'Comma',
  ':': 'Colon',
};
