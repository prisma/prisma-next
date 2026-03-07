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
    const token = this.#buffer.shift() ?? scan(this.#source, this.#pos);
    this.#pos += token.text.length;
    return token;
  }

  peek(offset = 0): Token {
    while (this.#buffer.length <= offset) {
      const last = this.#buffer.at(-1);
      if (last?.kind === 'Eof') {
        break;
      }
      const scanPos = this.#buffer.reduce((pos, t) => pos + t.text.length, this.#pos);
      this.#buffer.push(scan(this.#source, scanPos));
    }
    return (
      this.#buffer[offset] ?? this.#buffer[this.#buffer.length - 1] ?? scan(this.#source, this.#pos)
    );
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
