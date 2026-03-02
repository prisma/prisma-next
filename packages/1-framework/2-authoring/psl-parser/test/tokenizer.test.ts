import { describe, expect, it } from 'vitest';
import type { Token } from '../src/tokenizer';
import { Tokenizer } from '../src/tokenizer';

const KIND_COLUMN_WIDTH = 15;

function escapeForDebug(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    .replaceAll('"', '\\"');
}

function debugTokens(tokens: Iterable<Token>): string {
  const lines: string[] = [];
  for (const token of tokens) {
    lines.push(`${token.kind.padEnd(KIND_COLUMN_WIDTH)}"${escapeForDebug(token.text)}"`);
  }
  return lines.join('\n');
}

function collectAll(source: string): Token[] {
  const t = new Tokenizer(source);
  const tokens: Token[] = [];
  let tok: Token;
  do {
    tok = t.next();
    tokens.push(tok);
  } while (tok.kind !== 'Eof');
  return tokens;
}

function tokenize(source: string): string {
  return debugTokens(collectAll(source));
}

function assertLossless(source: string): void {
  const tokens = collectAll(source);
  expect(tokens.map((t) => t.text).join('')).toBe(source);
}

describe('Tokenizer', () => {
  describe('PSL fragments', () => {
    it('tokenizes a model with fields and attributes', () => {
      assertLossless('model User {\n  id Int @id\n}');
      expect(tokenize('model User {\n  id Int @id\n}')).toMatchInlineSnapshot(`
        "Ident          "model"
        Whitespace     " "
        Ident          "User"
        Whitespace     " "
        LBrace         "{"
        Newline        "\\n"
        Whitespace     "  "
        Ident          "id"
        Whitespace     " "
        Ident          "Int"
        Whitespace     " "
        At             "@"
        Ident          "id"
        Newline        "\\n"
        RBrace         "}"
        Eof            """
      `);
    });

    it('tokenizes optional and array types', () => {
      expect(tokenize('role Role?\nposts Post[]')).toMatchInlineSnapshot(`
        "Ident          "role"
        Whitespace     " "
        Ident          "Role"
        Question       "?"
        Newline        "\\n"
        Ident          "posts"
        Whitespace     " "
        Ident          "Post"
        LBracket       "["
        RBracket       "]"
        Eof            """
      `);
    });

    it('tokenizes @relation with named arguments', () => {
      expect(tokenize('@relation(fields: [userId], references: [id])')).toMatchInlineSnapshot(`
        "At             "@"
        Ident          "relation"
        LParen         "("
        Ident          "fields"
        Colon          ":"
        Whitespace     " "
        LBracket       "["
        Ident          "userId"
        RBracket       "]"
        Comma          ","
        Whitespace     " "
        Ident          "references"
        Colon          ":"
        Whitespace     " "
        LBracket       "["
        Ident          "id"
        RBracket       "]"
        RParen         ")"
        Eof            """
      `);
    });

    it('tokenizes block attribute @@index', () => {
      expect(tokenize('@@index([userId])')).toMatchInlineSnapshot(`
        "DoubleAt       "@@"
        Ident          "index"
        LParen         "("
        LBracket       "["
        Ident          "userId"
        RBracket       "]"
        RParen         ")"
        Eof            """
      `);
    });

    it('tokenizes comment followed by model', () => {
      expect(tokenize('// config\nmodel C {}')).toMatchInlineSnapshot(`
        "Comment        "// config"
        Newline        "\\n"
        Ident          "model"
        Whitespace     " "
        Ident          "C"
        Whitespace     " "
        LBrace         "{"
        RBrace         "}"
        Eof            """
      `);
    });

    it('tokenizes string default value', () => {
      expect(tokenize('@default("unknown")')).toMatchInlineSnapshot(`
        "At             "@"
        Ident          "default"
        LParen         "("
        StringLiteral  "\\"unknown\\""
        RParen         ")"
        Eof            """
      `);
    });

    it('tokenizes namespaced attribute with dot', () => {
      expect(tokenize('@db.VarChar(191)')).toMatchInlineSnapshot(`
        "At             "@"
        Ident          "db"
        Dot            "."
        Ident          "VarChar"
        LParen         "("
        NumberLiteral  "191"
        RParen         ")"
        Eof            """
      `);
    });

    it('tokenizes types block with equals', () => {
      expect(tokenize('Email = String')).toMatchInlineSnapshot(`
        "Ident          "Email"
        Whitespace     " "
        Equals         "="
        Whitespace     " "
        Ident          "String"
        Eof            """
      `);
    });

    it('tokenizes hyphenated attribute namespace', () => {
      expect(tokenize('@my-pack.column')).toMatchInlineSnapshot(`
        "At             "@"
        Ident          "my-pack"
        Dot            "."
        Ident          "column"
        Eof            """
      `);
    });

    it('tokenizes unicode identifiers', () => {
      expect(tokenize('café Ñame 名前')).toMatchInlineSnapshot(`
        "Ident          "café"
        Whitespace     " "
        Ident          "Ñame"
        Whitespace     " "
        Ident          "名前"
        Eof            """
      `);
    });
  });

  describe('edge cases', () => {
    it('handles \\r\\n line endings (lossless)', () => {
      const schema = 'model User {\r\n  id Int\r\n}';
      assertLossless(schema);
      expect(tokenize(schema)).toMatchInlineSnapshot(`
        "Ident          "model"
        Whitespace     " "
        Ident          "User"
        Whitespace     " "
        LBrace         "{"
        Newline        "\\r\\n"
        Whitespace     "  "
        Ident          "id"
        Whitespace     " "
        Ident          "Int"
        Newline        "\\r\\n"
        RBrace         "}"
        Eof            """
      `);
    });

    it('handles number literals and trailing dots', () => {
      expect(tokenize('1.5')).toMatchInlineSnapshot(`
        "NumberLiteral  "1.5"
        Eof            """
      `);
      expect(tokenize('1.')).toMatchInlineSnapshot(`
        "NumberLiteral  "1"
        Dot            "."
        Eof            """
      `);
    });

    it('handles negative number literals', () => {
      expect(tokenize('-1')).toMatchInlineSnapshot(`
        "NumberLiteral  "-1"
        Eof            """
      `);
      expect(tokenize('-3.14')).toMatchInlineSnapshot(`
        "NumberLiteral  "-3.14"
        Eof            """
      `);
      expect(tokenize('@default(-1)')).toMatchInlineSnapshot(`
        "At             "@"
        Ident          "default"
        LParen         "("
        NumberLiteral  "-1"
        RParen         ")"
        Eof            """
      `);
    });

    it('handles string escapes and unterminated strings', () => {
      expect(tokenize('"hello \\"world\\""')).toMatchInlineSnapshot(`
        "StringLiteral  "\\"hello \\\\\\"world\\\\\\"\\""
        Eof            """
      `);
      expect(tokenize('"hello\nworld')).toMatchInlineSnapshot(`
        "StringLiteral  "\\"hello"
        Newline        "\\n"
        Ident          "world"
        Eof            """
      `);
      expect(tokenize('"hello')).toMatchInlineSnapshot(`
        "StringLiteral  "\\"hello"
        Eof            """
      `);
    });

    it('emits single-char Invalid tokens for unknown characters', () => {
      assertLossless('#$%^&');
      expect(tokenize('#$%^&')).toMatchInlineSnapshot(`
        "Invalid        "#"
        Invalid        "$"
        Invalid        "%"
        Invalid        "^"
        Invalid        "&"
        Eof            """
      `);
    });

    it('resumes known tokens after Invalid', () => {
      assertLossless('#$model');
      expect(tokenize('#$model')).toMatchInlineSnapshot(`
        "Invalid        "#"
        Invalid        "$"
        Ident          "model"
        Eof            """
      `);
    });

    it('handles lone / and ! as Invalid', () => {
      expect(tokenize('!/')).toMatchInlineSnapshot(`
        "Invalid        "!"
        Invalid        "/"
        Eof            """
      `);
    });

    it('never throws on pathological input', () => {
      const nasty = '!@#$%^&*(){}[]<>~`|\\;\'"/?.,\x00\x01\x02';
      assertLossless(nasty);
      expect(() => tokenize(nasty)).not.toThrow();
    });
  });

  describe('offsets', () => {
    it('each token offset equals sum of preceding text lengths', () => {
      const source = 'model User {\n  id Int @id\n}\n';
      const tokens = collectAll(source);
      let expectedOffset = 0;
      for (const token of tokens) {
        expect(token.offset).toBe(expectedOffset);
        expectedOffset += token.text.length;
      }
    });

    it('Eof offset equals source length', () => {
      const source = 'model User {}';
      const tokens = collectAll(source);
      const eof = tokens[tokens.length - 1]!;
      expect(eof.kind).toBe('Eof');
      expect(eof.offset).toBe(source.length);
    });
  });

  describe('cursor API', () => {
    it('peek(0) returns the same token as a subsequent next()', () => {
      const t = new Tokenizer('model User');
      const peeked = t.peek(0);
      const consumed = t.next();
      expect(peeked).toEqual(consumed);
    });

    it('peek(1) returns the token after the next one', () => {
      const t = new Tokenizer('model User');
      const peekOne = t.peek(1);
      t.next(); // consume 'model'
      const second = t.next(); // consume ' '
      expect(peekOne).toEqual(second);
    });

    it('returns Eof indefinitely after source is exhausted', () => {
      const t = new Tokenizer('a');
      expect(t.next().kind).toBe('Ident');
      expect(t.next().kind).toBe('Eof');
      expect(t.next().kind).toBe('Eof');
      expect(t.next().kind).toBe('Eof');
    });

    it('peek(0) returns Eof after Eof has been consumed', () => {
      const t = new Tokenizer('a');
      t.next(); // 'a'
      t.next(); // Eof
      expect(t.peek(0).kind).toBe('Eof');
    });
  });
});
