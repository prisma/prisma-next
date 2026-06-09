import type { PslDiagnosticCode } from '@prisma-next/framework-components/psl-ast';
import { type Range, SourceFile } from './source-file';
import type { GreenNode } from './syntax/green';
import { GreenNodeBuilder } from './syntax/green-builder';
import type { SyntaxKind } from './syntax/syntax-kind';
import { type Token, Tokenizer, type TokenKind } from './tokenizer';

export interface ParseDiagnostic {
  readonly code: PslDiagnosticCode;
  readonly message: string;
  readonly range: Range;
}

const TRIVIA_KINDS: ReadonlySet<TokenKind> = new Set<TokenKind>([
  'Whitespace',
  'Newline',
  'Comment',
]);

const EOF_TOKEN: Token = { kind: 'Eof', text: '' };

/**
 * Pulls every token from the {@link Tokenizer} in a single pass — including
 * trivia (`Whitespace`/`Newline`/`Comment`) and `Invalid` tokens, terminated by
 * `Eof` — alongside a parallel array whose `i`-th entry is the absolute source
 * offset of token `i` (the sum of the text lengths of the tokens before it).
 */
export function pullTokens(source: string): {
  readonly tokens: readonly Token[];
  readonly offsets: readonly number[];
} {
  const tokenizer = new Tokenizer(source);
  const tokens: Token[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (;;) {
    const token = tokenizer.next();
    tokens.push(token);
    offsets.push(offset);
    if (token.kind === 'Eof') break;
    offset += token.text.length;
  }
  return { tokens, offsets };
}

/**
 * The fault-tolerant parser substrate the leaf and (later) declaration grammars
 * drive. It owns the token cursor, the green-tree builder with its
 * trivia-attachment discipline, the diagnostic sink, and the recovery
 * primitive. Trivia is flushed into the enclosing open node, so every child
 * node spans exactly its first through last significant token.
 */
export interface ParserCursor {
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly sourceFile: SourceFile;
  peekKind(ahead?: number): TokenKind;
  peekToken(ahead?: number): Token;
  currentSignificantIndex(): number;
  startNode(kind: SyntaxKind): void;
  finishNode(): GreenNode;
  bump(): Token;
  captureBalancedBraces(): void;
  recoverToSyncPoint(): void;
  diagnostic(code: PslDiagnosticCode, message: string, tokenIndex: number): void;
}

export function createParserCursor(source: string): ParserCursor {
  return new Cursor(source);
}

class Cursor implements ParserCursor {
  readonly #tokens: readonly Token[];
  readonly #offsets: readonly number[];
  readonly #sourceFile: SourceFile;
  readonly #builder = new GreenNodeBuilder();
  readonly #diagnostics: ParseDiagnostic[] = [];
  #pos = 0;
  #depth = 0;

  constructor(source: string) {
    const { tokens, offsets } = pullTokens(source);
    this.#tokens = tokens;
    this.#offsets = offsets;
    this.#sourceFile = new SourceFile(source);
  }

  get diagnostics(): readonly ParseDiagnostic[] {
    return this.#diagnostics;
  }

  get sourceFile(): SourceFile {
    return this.#sourceFile;
  }

  peekKind(ahead = 0): TokenKind {
    return this.peekToken(ahead).kind;
  }

  peekToken(ahead = 0): Token {
    let index = this.#pos;
    let remaining = ahead;
    for (;;) {
      const token = this.#tokens[index] ?? EOF_TOKEN;
      if (token.kind === 'Eof') return token;
      if (TRIVIA_KINDS.has(token.kind)) {
        index++;
        continue;
      }
      if (remaining === 0) return token;
      remaining--;
      index++;
    }
  }

  currentSignificantIndex(): number {
    let index = this.#pos;
    for (;;) {
      const token = this.#tokens[index];
      if (!token || token.kind === 'Eof' || !TRIVIA_KINDS.has(token.kind)) {
        return Math.min(index, this.#tokens.length - 1);
      }
      index++;
    }
  }

  startNode(kind: SyntaxKind): void {
    if (this.#depth > 0) {
      this.#flushTrivia();
    }
    this.#builder.startNode(kind);
    this.#depth++;
  }

  finishNode(): GreenNode {
    this.#depth--;
    return this.#builder.finishNode();
  }

  bump(): Token {
    this.#flushTrivia();
    const token = this.#tokens[this.#pos] ?? EOF_TOKEN;
    if (token.kind === 'Eof') return token;
    this.#builder.token(token.kind, token.text);
    this.#pos++;
    return token;
  }

  captureBalancedBraces(): void {
    this.#flushTrivia();
    let depth = 0;
    for (;;) {
      const token = this.#tokens[this.#pos];
      if (!token || token.kind === 'Eof') return;
      this.#builder.token(token.kind, token.text);
      this.#pos++;
      if (token.kind === 'LBrace') {
        depth++;
      } else if (token.kind === 'RBrace') {
        depth--;
        if (depth <= 0) return;
      }
    }
  }

  recoverToSyncPoint(): void {
    for (;;) {
      const token = this.#tokens[this.#pos];
      if (!token || token.kind === 'Eof' || token.kind === 'Newline' || token.kind === 'RBrace') {
        return;
      }
      this.#builder.token(token.kind, token.text);
      this.#pos++;
    }
  }

  diagnostic(code: PslDiagnosticCode, message: string, tokenIndex: number): void {
    const token = this.#tokens[tokenIndex] ?? EOF_TOKEN;
    const start = this.#offsets[tokenIndex] ?? this.#sourceFile.length;
    const end = start + token.text.length;
    this.#diagnostics.push({
      code,
      message,
      range: {
        start: this.#sourceFile.positionAt(start),
        end: this.#sourceFile.positionAt(end),
      },
    });
  }

  #flushTrivia(): void {
    for (;;) {
      const token = this.#tokens[this.#pos];
      if (!token || !TRIVIA_KINDS.has(token.kind)) return;
      this.#builder.token(token.kind, token.text);
      this.#pos++;
    }
  }
}

const INVALID_QUALIFIED_TYPE = 'PSL_INVALID_QUALIFIED_TYPE';
const INVALID_ATTRIBUTE_SYNTAX = 'PSL_INVALID_ATTRIBUTE_SYNTAX';

function parseIdentifier(cursor: ParserCursor): void {
  cursor.startNode('Identifier');
  cursor.bump();
  cursor.finishNode();
}

/**
 * Parses a single expression in argument or element position. Returns the
 * produced node, or `undefined` when the next significant token does not start a
 * recognised expression (the caller decides how to recover — e.g. capturing a
 * `{…}` object literal as balanced raw tokens).
 */
export function parseExpression(cursor: ParserCursor): GreenNode | undefined {
  const kind = cursor.peekKind();
  if (kind === 'StringLiteral') {
    cursor.startNode('StringLiteralExpr');
    cursor.bump();
    return cursor.finishNode();
  }
  if (kind === 'NumberLiteral') {
    cursor.startNode('NumberLiteralExpr');
    cursor.bump();
    return cursor.finishNode();
  }
  if (kind === 'LBracket') {
    return parseArrayLiteral(cursor);
  }
  if (kind === 'Ident') {
    if (cursor.peekKind(1) === 'LParen') {
      return parseFunctionCall(cursor);
    }
    const text = cursor.peekToken().text;
    if (text === 'true' || text === 'false') {
      cursor.startNode('BooleanLiteralExpr');
      cursor.bump();
      return cursor.finishNode();
    }
    cursor.startNode('Identifier');
    cursor.bump();
    return cursor.finishNode();
  }
  return undefined;
}

function parseArrayLiteral(cursor: ParserCursor): GreenNode {
  cursor.startNode('ArrayLiteral');
  cursor.bump(); // LBracket
  while (cursor.peekKind() !== 'RBracket' && cursor.peekKind() !== 'Eof') {
    const element = parseExpression(cursor);
    if (!element) break;
    if (cursor.peekKind() === 'Comma') {
      cursor.bump();
    } else {
      break;
    }
  }
  if (cursor.peekKind() === 'RBracket') {
    cursor.bump();
  }
  return cursor.finishNode();
}

function parseFunctionCall(cursor: ParserCursor): GreenNode {
  cursor.startNode('FunctionCall');
  parseIdentifier(cursor);
  parseParenArgs(cursor);
  return cursor.finishNode();
}

/**
 * Parses a parenthesised, comma-separated `AttributeArg` list into the
 * currently open node (a `FunctionCall` or an `AttributeArgList`), consuming the
 * surrounding parentheses.
 */
function parseParenArgs(cursor: ParserCursor): void {
  cursor.bump(); // LParen
  while (cursor.peekKind() !== 'RParen' && cursor.peekKind() !== 'Eof') {
    parseAttributeArg(cursor);
    if (cursor.peekKind() === 'Comma') {
      cursor.bump();
    } else {
      break;
    }
  }
  if (cursor.peekKind() === 'RParen') {
    cursor.bump();
  }
}

export function parseAttributeArg(cursor: ParserCursor): GreenNode {
  cursor.startNode('AttributeArg');
  if (cursor.peekKind() === 'Ident' && cursor.peekKind(1) === 'Colon') {
    parseIdentifier(cursor); // argument name
    cursor.bump(); // Colon
  }
  parseArgValue(cursor);
  return cursor.finishNode();
}

function parseArgValue(cursor: ParserCursor): void {
  const value = parseExpression(cursor);
  if (!value && cursor.peekKind() === 'LBrace') {
    // No SyntaxKind models an object literal; capture it as balanced raw tokens
    // so the round-trip still holds and the value is simply left uninterpreted.
    cursor.captureBalancedBraces();
  }
}

export function parseAttributeArgList(cursor: ParserCursor): GreenNode {
  cursor.startNode('AttributeArgList');
  parseParenArgs(cursor);
  return cursor.finishNode();
}

export function parseAttribute(cursor: ParserCursor): GreenNode {
  const isBlockAttribute = cursor.peekKind() === 'DoubleAt';
  const markerIndex = cursor.currentSignificantIndex();
  cursor.startNode(isBlockAttribute ? 'ModelAttribute' : 'FieldAttribute');
  cursor.bump(); // At or DoubleAt
  if (cursor.peekKind() === 'Ident') {
    parseIdentifier(cursor);
    if (cursor.peekKind() === 'Dot') {
      cursor.bump(); // Dot
      if (cursor.peekKind() === 'Ident') {
        parseIdentifier(cursor);
      } else {
        cursor.diagnostic(
          INVALID_ATTRIBUTE_SYNTAX,
          'Attribute name expected after "."',
          cursor.currentSignificantIndex(),
        );
      }
    }
  } else {
    cursor.diagnostic(INVALID_ATTRIBUTE_SYNTAX, 'Attribute name expected', markerIndex);
  }
  if (cursor.peekKind() === 'LParen') {
    parseAttributeArgList(cursor);
  }
  return cursor.finishNode();
}

export function parseTypeAnnotation(cursor: ParserCursor): GreenNode {
  cursor.startNode('TypeAnnotation');
  if (cursor.peekKind() === 'Ident' && cursor.peekKind(1) === 'LParen') {
    parseFunctionCall(cursor); // inline constructor, e.g. Vector(1536)
  } else if (cursor.peekKind() === 'Ident') {
    parseIdentifier(cursor); // base name or space/namespace segment
    parseQualifierSegments(cursor, 'Colon');
    parseQualifierSegments(cursor, 'Dot');
  }
  if (cursor.peekKind() === 'LBracket') {
    cursor.bump();
    if (cursor.peekKind() === 'RBracket') {
      cursor.bump();
    }
  }
  if (cursor.peekKind() === 'Question') {
    cursor.bump();
  }
  return cursor.finishNode();
}

/**
 * Consumes a run of `<separator> Ident` qualifier segments. A well-formed type
 * carries at most one colon-introduced space and one dot-introduced namespace;
 * any second separator of the same kind is over-qualification and emits
 * `PSL_INVALID_QUALIFIED_TYPE` pointed at the offending separator, while still
 * consuming the segment so the subtree (and the round-trip) stays intact.
 */
function parseQualifierSegments(cursor: ParserCursor, separator: 'Colon' | 'Dot'): void {
  let seen = 0;
  while (cursor.peekKind() === separator) {
    seen++;
    const separatorIndex = cursor.currentSignificantIndex();
    cursor.bump(); // separator
    if (seen > 1) {
      cursor.diagnostic(
        INVALID_QUALIFIED_TYPE,
        'Qualified type reference has too many segments',
        separatorIndex,
      );
    }
    if (cursor.peekKind() === 'Ident') {
      parseIdentifier(cursor);
    }
  }
}
