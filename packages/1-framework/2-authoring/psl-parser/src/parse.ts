import type { PslDiagnosticCode } from '@prisma-next/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { type Range, SourceFile } from './source-file';
import { DocumentAst } from './syntax/ast/declarations';
import type { GreenNode } from './syntax/green';
import { GreenNodeBuilder } from './syntax/green-builder';
import { createSyntaxTree } from './syntax/red';
import type { SyntaxKind } from './syntax/syntax-kind';
import { type Token, Tokenizer, type TokenKind } from './tokenizer';

export interface ParseDiagnostic {
  readonly code: PslDiagnosticCode;
  readonly message: string;
  readonly range: Range;
}

export interface ParseResult {
  readonly document: DocumentAst;
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly sourceFile: SourceFile;
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
  flushTrivia(): void;
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

  flushTrivia(): void {
    this.#flushTrivia();
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

const UNTERMINATED_BLOCK = 'PSL_UNTERMINATED_BLOCK';
const UNSUPPORTED_TOP_LEVEL_BLOCK = 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK';
const INVALID_NAMESPACE_BLOCK = 'PSL_INVALID_NAMESPACE_BLOCK';
const INVALID_MODEL_MEMBER = 'PSL_INVALID_MODEL_MEMBER';
const INVALID_ENUM_MEMBER = 'PSL_INVALID_ENUM_MEMBER';
const INVALID_TYPES_MEMBER = 'PSL_INVALID_TYPES_MEMBER';
const INVALID_EXTENSION_BLOCK_MEMBER = 'PSL_INVALID_EXTENSION_BLOCK_MEMBER';

type MemberParser = (cursor: ParserCursor) => void;

interface DocumentState {
  topLevelTypesSeen: boolean;
}

/**
 * Drives the recursive descent over a full PSL document. Tokenizes via the
 * substrate cursor, builds a complete green/red tree wrapped as a
 * {@link DocumentAst}, collects every syntactic {@link ParseDiagnostic}, and
 * never throws — malformed input yields diagnostics and a recovered tree, not
 * an exception.
 */
export function parse(source: string): ParseResult {
  const cursor = createParserCursor(source);
  const green = parseDocument(cursor);
  const root = createSyntaxTree(green);
  const document = DocumentAst.cast(root) ?? new DocumentAst(root);
  return { document, diagnostics: cursor.diagnostics, sourceFile: cursor.sourceFile };
}

function parseDocument(cursor: ParserCursor): GreenNode {
  cursor.startNode('Document');
  const state: DocumentState = { topLevelTypesSeen: false };
  while (cursor.peekKind() !== 'Eof') {
    parseDeclaration(cursor, false, state);
  }
  cursor.flushTrivia(); // attach trailing trivia so the round-trip stays lossless
  return cursor.finishNode();
}

/**
 * Recognises one top-level (or namespace-body) declaration. Recognition is
 * keyword + bounded `peekKind` lookahead: `model`/`enum`/`namespace` need a name
 * then `{`; `type {` is a types block while `type Ident {` is a composite type;
 * any other `kw [Ident] {` is a generic block. Anything else is unsupported.
 */
function parseDeclaration(
  cursor: ParserCursor,
  insideNamespace: boolean,
  state: DocumentState,
): void {
  if (cursor.peekKind() === 'Ident') {
    const keyword = cursor.peekToken().text;
    if (keyword === 'model' && nameThenBrace(cursor)) {
      parseNamedBlock(cursor, 'ModelDeclaration', parseModelMember);
      return;
    }
    if (keyword === 'enum' && nameThenBrace(cursor)) {
      parseNamedBlock(cursor, 'EnumDeclaration', parseEnumMember);
      return;
    }
    if (keyword === 'namespace' && nameThenBrace(cursor)) {
      parseNamespace(cursor, insideNamespace, state);
      return;
    }
    if (keyword === 'type') {
      if (cursor.peekKind(1) === 'LBrace') {
        parseTypesBlock(cursor, insideNamespace, state);
        return;
      }
      if (cursor.peekKind(1) === 'Ident' && cursor.peekKind(2) === 'LBrace') {
        parseNamedBlock(cursor, 'CompositeTypeDeclaration', parseModelMember);
        return;
      }
    } else if (keyword !== 'model' && keyword !== 'enum' && keyword !== 'namespace') {
      if (cursor.peekKind(1) === 'LBrace') {
        parseGenericBlock(cursor, false);
        return;
      }
      if (cursor.peekKind(1) === 'Ident' && cursor.peekKind(2) === 'LBrace') {
        parseGenericBlock(cursor, true);
        return;
      }
    }
  }
  parseUnsupportedTopLevel(cursor);
}

function nameThenBrace(cursor: ParserCursor): boolean {
  return cursor.peekKind(1) === 'Ident' && cursor.peekKind(2) === 'LBrace';
}

function parseNamedBlock(cursor: ParserCursor, kind: SyntaxKind, parseMember: MemberParser): void {
  cursor.startNode(kind);
  cursor.bump(); // keyword
  parseIdentifier(cursor); // name
  parseBlockBody(cursor, parseMember);
  cursor.finishNode();
}

function parseGenericBlock(cursor: ParserCursor, hasName: boolean): void {
  cursor.startNode('BlockDeclaration');
  cursor.bump(); // keyword
  if (hasName) {
    parseIdentifier(cursor);
  }
  parseBlockBody(cursor, parseKeyValueMember);
  cursor.finishNode();
}

function parseNamespace(
  cursor: ParserCursor,
  insideNamespace: boolean,
  state: DocumentState,
): void {
  const keywordIndex = cursor.currentSignificantIndex();
  cursor.startNode('Namespace');
  cursor.bump(); // namespace
  const name = cursor.peekKind() === 'Ident' ? cursor.peekToken().text : '';
  if (cursor.peekKind() === 'Ident') {
    parseIdentifier(cursor);
  }
  if (insideNamespace) {
    cursor.diagnostic(
      INVALID_NAMESPACE_BLOCK,
      `Recursive "namespace ${name}" block is not allowed; namespace blocks may not nest`,
      keywordIndex,
    );
  } else if (name === UNSPECIFIED_PSL_NAMESPACE_ID) {
    cursor.diagnostic(
      INVALID_NAMESPACE_BLOCK,
      `Namespace name "${UNSPECIFIED_PSL_NAMESPACE_ID}" is reserved for the parser-synthesised bucket for top-level declarations`,
      keywordIndex,
    );
  }
  parseBlockBody(cursor, (inner) => parseDeclaration(inner, true, state));
  cursor.finishNode();
}

function parseTypesBlock(
  cursor: ParserCursor,
  insideNamespace: boolean,
  state: DocumentState,
): void {
  const keywordIndex = cursor.currentSignificantIndex();
  cursor.startNode('TypesBlock');
  if (insideNamespace) {
    cursor.diagnostic(
      INVALID_NAMESPACE_BLOCK,
      '`types` blocks must be declared at the document top level, not inside a namespace block',
      keywordIndex,
    );
  } else if (state.topLevelTypesSeen) {
    cursor.diagnostic(
      INVALID_TYPES_MEMBER,
      'Only one top-level `types` block is allowed per document',
      keywordIndex,
    );
  } else {
    state.topLevelTypesSeen = true;
  }
  cursor.bump(); // type
  parseBlockBody(cursor, parseNamedTypeMember);
  cursor.finishNode();
}

/**
 * Parses a `{ … }` block body: consumes the braces, dispatches each member to
 * `parseMember` until the closing brace or EOF, and flags an unclosed block.
 * Every `parseMember` consumes at least one significant token, so the loop
 * always terminates.
 */
function parseBlockBody(cursor: ParserCursor, parseMember: MemberParser): void {
  const braceIndex = cursor.currentSignificantIndex();
  cursor.bump(); // LBrace
  for (;;) {
    const kind = cursor.peekKind();
    if (kind === 'RBrace' || kind === 'Eof') break;
    parseMember(cursor);
  }
  if (cursor.peekKind() === 'RBrace') {
    cursor.bump();
  } else {
    cursor.diagnostic(UNTERMINATED_BLOCK, 'Unterminated block declaration', braceIndex);
  }
}

function parseUnsupportedTopLevel(cursor: ParserCursor): void {
  const offending = cursor.peekToken().text;
  const message =
    cursor.peekKind(1) === 'LBrace'
      ? `Unsupported top-level block "${offending}"`
      : `Unsupported top-level declaration "${offending}"`;
  cursor.diagnostic(UNSUPPORTED_TOP_LEVEL_BLOCK, message, cursor.currentSignificantIndex());
  cursor.bump();
  cursor.recoverToSyncPoint();
}

function parseModelMember(cursor: ParserCursor): void {
  const kind = cursor.peekKind();
  if (kind === 'DoubleAt') {
    parseAttribute(cursor);
    return;
  }
  if (kind === 'Ident') {
    parseField(cursor);
    return;
  }
  invalidMember(
    cursor,
    INVALID_MODEL_MEMBER,
    `Invalid model member declaration "${cursor.peekToken().text}"`,
  );
}

function parseEnumMember(cursor: ParserCursor): void {
  const kind = cursor.peekKind();
  if (kind === 'DoubleAt') {
    parseAttribute(cursor);
    return;
  }
  if (kind === 'Ident') {
    parseEnumValue(cursor);
    return;
  }
  invalidMember(
    cursor,
    INVALID_ENUM_MEMBER,
    `Invalid enum value declaration "${cursor.peekToken().text}"`,
  );
}

function parseNamedTypeMember(cursor: ParserCursor): void {
  if (cursor.peekKind() === 'Ident') {
    parseNamedType(cursor);
    return;
  }
  invalidMember(
    cursor,
    INVALID_TYPES_MEMBER,
    `Invalid types declaration "${cursor.peekToken().text}"`,
  );
}

function parseKeyValueMember(cursor: ParserCursor): void {
  if (cursor.peekKind() === 'Ident') {
    parseKeyValue(cursor);
    return;
  }
  invalidMember(cursor, INVALID_EXTENSION_BLOCK_MEMBER, 'Invalid block entry');
}

function invalidMember(cursor: ParserCursor, code: PslDiagnosticCode, message: string): void {
  cursor.diagnostic(code, message, cursor.currentSignificantIndex());
  cursor.bump(); // consume the offending token so the member loop makes progress
  cursor.recoverToSyncPoint();
}

function parseField(cursor: ParserCursor): void {
  cursor.startNode('FieldDeclaration');
  parseIdentifier(cursor); // name
  parseTypeAnnotation(cursor);
  while (cursor.peekKind() === 'At') {
    parseAttribute(cursor);
  }
  cursor.finishNode();
}

function parseEnumValue(cursor: ParserCursor): void {
  cursor.startNode('EnumValueDeclaration');
  parseIdentifier(cursor); // name
  while (cursor.peekKind() === 'At') {
    parseAttribute(cursor);
  }
  cursor.finishNode();
}

function parseNamedType(cursor: ParserCursor): void {
  cursor.startNode('NamedTypeDeclaration');
  parseIdentifier(cursor); // name
  if (cursor.peekKind() === 'Equals') {
    cursor.bump();
  }
  parseTypeAnnotation(cursor);
  while (cursor.peekKind() === 'At') {
    parseAttribute(cursor);
  }
  cursor.finishNode();
}

function parseKeyValue(cursor: ParserCursor): void {
  cursor.startNode('KeyValuePair');
  parseIdentifier(cursor); // key
  if (cursor.peekKind() === 'Equals') {
    cursor.bump();
  }
  const value = parseExpression(cursor);
  if (!value && cursor.peekKind() === 'LBrace') {
    cursor.captureBalancedBraces();
  }
  cursor.finishNode();
}
