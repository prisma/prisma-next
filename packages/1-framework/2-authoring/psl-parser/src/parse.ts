import type { PslDiagnosticCode } from '@prisma-next/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { type Range, SourceFile } from './source-file';
import { DocumentAst } from './syntax/ast/declarations';
import type { GreenNode } from './syntax/green';
import { GreenNodeBuilder } from './syntax/green-builder';
import { createSyntaxTree } from './syntax/red';
import type { SyntaxKind } from './syntax/syntax-kind';
import { isTerminatedStringLiteral, type Token, Tokenizer, type TokenKind } from './tokenizer';

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

/**
 * The absolute source span of a single token, captured for a diagnostic: the
 * token's start offset (total source text consumed before it) and its text
 * length. Captured eagerly so a marker stays valid after the cursor advances
 * past the token it points at.
 */
export interface DiagnosticMark {
  readonly offset: number;
  readonly length: number;
}

/**
 * The fault-tolerant parser substrate the leaf and (later) declaration grammars
 * drive. It owns the token cursor, the green-tree builder with its
 * trivia-attachment discipline, the diagnostic sink, and the recovery
 * primitive. Trivia is flushed into the enclosing open node, so every child
 * node spans exactly its first through last significant token.
 */
export class Cursor {
  readonly #tokenizer: Tokenizer;
  readonly #sourceFile: SourceFile;
  readonly #builder = new GreenNodeBuilder();
  readonly #diagnostics: ParseDiagnostic[] = [];
  #offset = 0;
  #depth = 0;

  constructor(source: string) {
    this.#tokenizer = new Tokenizer(source);
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
    let rawIndex = 0;
    let remaining = ahead;
    for (;;) {
      const token = this.#tokenizer.peek(rawIndex);
      if (token.kind === 'Eof') return token;
      if (TRIVIA_KINDS.has(token.kind)) {
        rawIndex++;
        continue;
      }
      if (remaining === 0) return token;
      remaining--;
      rawIndex++;
    }
  }

  /**
   * Span of the significant token `lookahead` positions ahead (`mark(0)` = the next,
   * `mark(1)` = the one after), captured eagerly so it stays valid after the cursor advances.
   */
  mark(lookahead = 0): DiagnosticMark {
    let rawIndex = 0;
    let offset = this.#offset;
    let remaining = lookahead;
    for (;;) {
      const token = this.#tokenizer.peek(rawIndex);
      if (token.kind === 'Eof') {
        return { offset, length: token.text.length };
      }
      if (!TRIVIA_KINDS.has(token.kind) && remaining === 0) {
        return { offset, length: token.text.length };
      }
      if (!TRIVIA_KINDS.has(token.kind)) {
        remaining--;
      }
      offset += token.text.length;
      rawIndex++;
    }
  }

  /**
   * Zero-width mark just past the last consumed significant token (before any trailing
   * trivia) — anchors an "expected here" diagnostic at the spot, e.g. the `{` missing
   * after a declaration's name.
   */
  markAfterLastToken(): DiagnosticMark {
    return { offset: this.#offset, length: 0 };
  }

  startNode(kind: SyntaxKind): void {
    if (this.#depth > 0) {
      this.flushTrivia();
    }
    this.#builder.startNode(kind);
    this.#depth++;
  }

  finishNode(): GreenNode {
    this.#depth--;
    return this.#builder.finishNode();
  }

  bump(): Token {
    this.flushTrivia();
    const token = this.#tokenizer.peek();
    if (token.kind === 'Eof') return token;
    this.#builder.token(token.kind, token.text);
    this.#advance();
    return token;
  }

  recoverToSyncPoint(): void {
    for (;;) {
      const token = this.#tokenizer.peek();
      if (token.kind === 'Eof' || token.kind === 'Newline' || token.kind === 'RBrace') {
        return;
      }
      this.#builder.token(token.kind, token.text);
      this.#advance();
    }
  }

  flushTrivia(): void {
    for (;;) {
      const token = this.#tokenizer.peek();
      if (!TRIVIA_KINDS.has(token.kind)) return;
      this.#builder.token(token.kind, token.text);
      this.#advance();
    }
  }

  diagnostic(code: PslDiagnosticCode, message: string, mark: DiagnosticMark): void {
    const start = mark.offset;
    const end = start + mark.length;
    this.#diagnostics.push({
      code,
      message,
      range: {
        start: this.#sourceFile.positionAt(start),
        end: this.#sourceFile.positionAt(end),
      },
    });
  }

  #advance(): void {
    this.#offset += this.#tokenizer.next().text.length;
  }
}

function parseIdentifier(cursor: Cursor): void {
  cursor.startNode('Identifier');
  cursor.bump();
  cursor.finishNode();
}

/**
 * Parses a single expression in argument or element position. Returns the
 * produced node, or `undefined` when the next significant token does not start a
 * recognised expression (the caller decides how to recover).
 */
export function parseExpression(cursor: Cursor): GreenNode | undefined {
  return (
    parseStringLiteralExpr(cursor) ??
    parseNumberLiteralExpr(cursor) ??
    parseArrayLiteral(cursor) ??
    parseObjectLiteralExpr(cursor) ??
    parseFunctionCall(cursor) ??
    parseBooleanLiteralExpr(cursor) ??
    parseIdentifierExpr(cursor)
  );
}

export function parseStringLiteralExpr(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'StringLiteral') return undefined;
  const stringMark = cursor.mark();
  const text = cursor.peekToken().text;
  cursor.startNode('StringLiteralExpr');
  cursor.bump();
  if (!isTerminatedStringLiteral(text)) {
    cursor.diagnostic('PSL_UNTERMINATED_STRING', 'Unterminated string literal', stringMark);
  }
  return cursor.finishNode();
}

export function parseNumberLiteralExpr(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'NumberLiteral') return undefined;
  cursor.startNode('NumberLiteralExpr');
  cursor.bump();
  return cursor.finishNode();
}

// Ordering among the `Ident`-leading alternatives is load-bearing: the
// `LParen` lookahead of `parseFunctionCall` must win before the boolean check,
// so `true(` stays a function call named `true` rather than a boolean literal.
export function parseBooleanLiteralExpr(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'Ident') return undefined;
  const text = cursor.peekToken().text;
  if (text !== 'true' && text !== 'false') return undefined;
  cursor.startNode('BooleanLiteralExpr');
  cursor.bump();
  return cursor.finishNode();
}

export function parseIdentifierExpr(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'Ident') return undefined;
  cursor.startNode('Identifier');
  cursor.bump();
  return cursor.finishNode();
}

export function parseArrayLiteral(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'LBracket') return undefined;
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

export function parseObjectLiteralExpr(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'LBrace') return undefined;
  const braceMark = cursor.mark();
  cursor.startNode('ObjectLiteralExpr');
  cursor.bump(); // LBrace
  while (cursor.peekKind() !== 'RBrace' && cursor.peekKind() !== 'Eof') {
    parseObjectField(cursor);
    if (cursor.peekKind() === 'Comma') {
      cursor.bump();
    } else if (cursor.peekKind() === 'Ident') {
      // A following identifier key with no separating comma re-enters the loop
      // (the next parseObjectField consumes the key, ≥1 token, guaranteeing
      // progress). Flag the missing comma at the gap after the previous field.
      cursor.diagnostic(
        'PSL_INVALID_OBJECT_LITERAL',
        'Expected "," between object-literal fields',
        cursor.markAfterLastToken(),
      );
    } else {
      // Anything else terminates the field list.
      break;
    }
  }
  if (cursor.peekKind() === 'RBrace') {
    cursor.bump();
  } else {
    cursor.diagnostic('PSL_INVALID_OBJECT_LITERAL', 'Unterminated object literal', braceMark);
  }
  return cursor.finishNode();
}

export function parseObjectField(cursor: Cursor): GreenNode {
  cursor.startNode('ObjectField');
  const keyMark = cursor.mark();
  const keyText = cursor.peekToken().text;
  if (cursor.peekKind() === 'Ident') {
    parseIdentifier(cursor); // identifier key — the only valid key
  } else if (cursor.peekKind() === 'StringLiteral') {
    // String keys are not valid PSL. Flag the key, then still consume it so the
    // field stays structured and the object/enclosing block don't desync (F04).
    cursor.diagnostic(
      'PSL_INVALID_OBJECT_LITERAL',
      'Object literal keys must be identifiers',
      keyMark,
    );
    parseStringLiteralExpr(cursor);
  }
  if (cursor.peekKind() === 'Colon') {
    cursor.bump(); // Colon
    const value = parseExpression(cursor);
    if (!value) {
      cursor.diagnostic('PSL_INVALID_OBJECT_LITERAL', 'Expected a value after ":"', cursor.mark());
    }
  } else {
    cursor.diagnostic('PSL_INVALID_OBJECT_LITERAL', `Expected ":" after "${keyText}"`, keyMark);
    const followsWithKey = cursor.peekKind() === 'Ident' && cursor.peekKind(1) === 'Colon';
    if (!followsWithKey) {
      parseExpression(cursor); // best-effort: consume a value if one follows
    }
  }
  return cursor.finishNode();
}

export function parseFunctionCall(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'Ident' || cursor.peekKind(1) !== 'LParen') return undefined;
  cursor.startNode('FunctionCall');
  parseIdentifier(cursor);
  parseParenArgs(cursor);
  return cursor.finishNode();
}

/**
 * Lookahead for a namespace-qualified constructor call — `ns.Ctor(`,
 * `a.b.Ctor(`, … — i.e. an identifier chain joined by `.` with at least one dot
 * segment, followed by `(`. The bare `Ctor(` form is owned by
 * {@link parseFunctionCall}; this predicate requires the qualifying dot so the
 * two branches stay disjoint.
 */
function isQualifiedConstructorCall(cursor: Cursor): boolean {
  if (cursor.peekKind() !== 'Ident') return false;
  let ahead = 1;
  let dots = 0;
  while (cursor.peekKind(ahead) === 'Dot' && cursor.peekKind(ahead + 1) === 'Ident') {
    dots++;
    ahead += 2;
  }
  return dots > 0 && cursor.peekKind(ahead) === 'LParen';
}

/**
 * Parses a namespace-qualified constructor call (`pgvector.Vector(1536)`) into a
 * {@link FunctionCall} node carrying the full identifier chain — the same node
 * kind the bare `Vector(1536)` form produces, so a single `constructorCall()`
 * accessor reads both; the resolver recovers the multi-segment path from the
 * chained identifiers.
 */
function parseQualifiedConstructorCall(cursor: Cursor): void {
  cursor.startNode('FunctionCall');
  parseIdentifier(cursor); // first namespace segment
  while (cursor.peekKind() === 'Dot' && cursor.peekKind(1) === 'Ident') {
    cursor.bump(); // Dot
    parseIdentifier(cursor); // next segment (the last is the constructor name)
  }
  parseParenArgs(cursor);
  cursor.finishNode();
}

/**
 * Parses a parenthesised, comma-separated `AttributeArg` list into the
 * currently open node (a `FunctionCall` or an `AttributeArgList`), consuming the
 * surrounding parentheses.
 */
function parseParenArgs(cursor: Cursor): void {
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

export function parseAttributeArg(cursor: Cursor): GreenNode {
  cursor.startNode('AttributeArg');
  if (cursor.peekKind() === 'Ident' && cursor.peekKind(1) === 'Colon') {
    parseIdentifier(cursor); // argument name
    cursor.bump(); // Colon
  }
  parseArgValue(cursor);
  return cursor.finishNode();
}

function parseArgValue(cursor: Cursor): void {
  parseExpression(cursor);
}

export function parseAttributeArgList(cursor: Cursor): GreenNode {
  cursor.startNode('AttributeArgList');
  parseParenArgs(cursor);
  return cursor.finishNode();
}

export function parseAttribute(cursor: Cursor): GreenNode {
  const isBlockAttribute = cursor.peekKind() === 'DoubleAt';
  const attributeMark = cursor.mark();
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
          'PSL_INVALID_ATTRIBUTE_SYNTAX',
          'Attribute name expected after "."',
          cursor.mark(),
        );
      }
    }
  } else {
    cursor.diagnostic('PSL_INVALID_ATTRIBUTE_SYNTAX', 'Attribute name expected', attributeMark);
  }
  if (cursor.peekKind() === 'LParen') {
    parseAttributeArgList(cursor);
  }
  return cursor.finishNode();
}

export function parseTypeAnnotation(cursor: Cursor): GreenNode {
  cursor.startNode('TypeAnnotation');
  if (cursor.peekKind() === 'Ident' && cursor.peekKind(1) === 'LParen') {
    parseFunctionCall(cursor); // inline constructor, e.g. Vector(1536)
  } else if (isQualifiedConstructorCall(cursor)) {
    parseQualifiedConstructorCall(cursor); // qualified constructor, e.g. pgvector.Vector(1536)
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
function parseQualifierSegments(cursor: Cursor, separator: 'Colon' | 'Dot'): void {
  let seen = 0;
  while (cursor.peekKind() === separator) {
    seen++;
    const separatorMark = cursor.mark();
    cursor.bump(); // separator
    if (seen > 1) {
      cursor.diagnostic(
        'PSL_INVALID_QUALIFIED_TYPE',
        'Qualified type reference has too many segments',
        separatorMark,
      );
    }
    if (cursor.peekKind() === 'Ident') {
      parseIdentifier(cursor);
    }
  }
}

type MemberParser = (cursor: Cursor) => void;

/**
 * Drives the recursive descent over a full PSL document. Tokenizes via the
 * substrate cursor, builds a complete green/red tree wrapped as a
 * {@link DocumentAst}, collects every syntactic {@link ParseDiagnostic}, and
 * never throws — malformed input yields diagnostics and a recovered tree, not
 * an exception.
 */
export function parse(source: string): ParseResult {
  const cursor = new Cursor(source);
  const green = parseDocument(cursor);
  const root = createSyntaxTree(green);
  const document = DocumentAst.cast(root) ?? new DocumentAst(root);
  return { document, diagnostics: cursor.diagnostics, sourceFile: cursor.sourceFile };
}

function parseDocument(cursor: Cursor): GreenNode {
  cursor.startNode('Document');
  while (cursor.peekKind() !== 'Eof') {
    parseDeclaration(cursor, false);
  }
  cursor.flushTrivia(); // attach trailing trivia so the round-trip stays lossless
  return cursor.finishNode();
}

const RESERVED_BLOCK_KEYWORDS: ReadonlySet<string> = new Set([
  'model',
  'enum',
  'namespace',
  'type',
  'types',
]);

function keywordIs(cursor: Cursor, keyword: string): boolean {
  return cursor.peekKind() === 'Ident' && cursor.peekToken().text === keyword;
}

/**
 * Recognises one top-level (or namespace-body) declaration as an ordered list of
 * alternatives composed with `??`. Each alternative owns its discriminating
 * `peekKind`/`peekToken` lookahead and is a no-op on non-match: it returns
 * `undefined` having consumed and mutated nothing, so the forward-only cursor is
 * never left half-consumed by a rejected alternative. The first alternative to
 * commit wins; when none match, the input is recovered as an unsupported
 * declaration. Recovery runs via the `if (!node)` tail rather than as a `??`
 * arm, because it appends raw tokens to the open parent instead of returning a
 * child node.
 */
function parseDeclaration(cursor: Cursor, insideNamespace: boolean): void {
  const name = cursor.peekKind(1) === 'Ident' ? cursor.peekToken(1).text : '';
  if (insideNamespace && keywordIs(cursor, 'namespace')) {
    cursor.diagnostic(
      'PSL_INVALID_NAMESPACE_BLOCK',
      `Recursive "namespace ${name}" block is not allowed; namespace blocks may not nest`,
      cursor.mark(),
    );
  } else if (insideNamespace && keywordIs(cursor, 'types')) {
    cursor.diagnostic(
      'PSL_INVALID_NAMESPACE_BLOCK',
      '`types` blocks must be declared at the document top level, not inside a namespace block',
      cursor.mark(),
    );
  } else if (keywordIs(cursor, 'namespace') && name === UNSPECIFIED_PSL_NAMESPACE_ID) {
    cursor.diagnostic(
      'PSL_INVALID_NAMESPACE_BLOCK',
      `Namespace name "${UNSPECIFIED_PSL_NAMESPACE_ID}" is reserved for the parser-synthesised bucket for top-level declarations`,
      cursor.mark(1),
    );
  }

  const node =
    parseModel(cursor) ??
    parseEnum(cursor) ??
    parseNamespace(cursor) ??
    parseCompositeType(cursor) ??
    parseTypesBlock(cursor) ??
    parseGenericBlock(cursor);
  if (!node) {
    parseUnsupportedTopLevel(cursor);
  }
}

/**
 * Reports only the first missing piece — a missing name suppresses the missing-brace
 * diagnostic. `nameRequired` is false only for the `types` block, which never has a name.
 */
function parseBlock(
  cursor: Cursor,
  kind: SyntaxKind,
  nameRequired: boolean,
  parseMember: MemberParser,
): GreenNode {
  const keyword = cursor.peekToken().text;
  const keywordMark = cursor.mark();
  cursor.startNode(kind);
  cursor.bump();
  const hasName = nameRequired && cursor.peekKind() === 'Ident';
  if (hasName) {
    parseIdentifier(cursor);
  }
  if (nameRequired && !hasName) {
    cursor.diagnostic('PSL_INVALID_DECLARATION', `Expected a name after "${keyword}"`, keywordMark);
  } else if (cursor.peekKind() !== 'LBrace') {
    cursor.diagnostic(
      'PSL_INVALID_DECLARATION',
      `Expected "{" to open the "${keyword}" block`,
      cursor.markAfterLastToken(),
    );
  }
  if (cursor.peekKind() === 'LBrace') {
    parseBlockBody(cursor, parseMember);
  } else {
    cursor.recoverToSyncPoint();
  }
  return cursor.finishNode();
}

export function parseModel(cursor: Cursor): GreenNode | undefined {
  if (!keywordIs(cursor, 'model')) return undefined;
  return parseBlock(cursor, 'ModelDeclaration', true, parseModelMember);
}

export function parseEnum(cursor: Cursor): GreenNode | undefined {
  if (!keywordIs(cursor, 'enum')) return undefined;
  return parseBlock(cursor, 'EnumDeclaration', true, parseEnumMember);
}

/**
 * Excluding the reserved keywords keeps a malformed reserved block (e.g. `model {` with
 * no name) routed to its dedicated parser. The generic keyword set is open
 * (extension-contributed), so a bare identifier with no brace (e.g. `oops`) is read as an
 * unfinished custom declaration — a committed `GenericBlockDeclaration` + missing-brace diagnostic
 * — not unsupported content. A non-identifier lead can't be a declaration name, so it falls
 * through to `parseUnsupportedTopLevel`.
 */
export function parseGenericBlock(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'Ident') return undefined;
  const keyword = cursor.peekToken().text;
  if (RESERVED_BLOCK_KEYWORDS.has(keyword)) return undefined;
  const hasName = cursor.peekKind(1) === 'Ident' && cursor.peekKind(2) === 'LBrace';
  cursor.startNode('GenericBlockDeclaration');
  cursor.bump();
  if (hasName) {
    parseIdentifier(cursor);
  }
  if (cursor.peekKind() === 'LBrace') {
    parseBlockBody(cursor, parseKeyValueMember);
  } else {
    cursor.diagnostic(
      'PSL_INVALID_DECLARATION',
      `Expected "{" to open the "${keyword}" block`,
      cursor.markAfterLastToken(),
    );
    cursor.recoverToSyncPoint();
  }
  return cursor.finishNode();
}

export function parseNamespace(cursor: Cursor): GreenNode | undefined {
  if (!keywordIs(cursor, 'namespace')) return undefined;
  return parseBlock(cursor, 'Namespace', true, (inner) => parseDeclaration(inner, true));
}

export function parseCompositeType(cursor: Cursor): GreenNode | undefined {
  if (!keywordIs(cursor, 'type')) return undefined;
  return parseBlock(cursor, 'CompositeTypeDeclaration', true, parseModelMember);
}

/** `types` (plural) is the no-name types block; the singular `type` is the composite type above. */
export function parseTypesBlock(cursor: Cursor): GreenNode | undefined {
  if (!keywordIs(cursor, 'types')) return undefined;
  return parseBlock(cursor, 'TypesBlock', false, parseNamedTypeMember);
}

/**
 * Parses a `{ … }` block body: consumes the braces, dispatches each member to
 * `parseMember` until the closing brace or EOF, and flags an unclosed block.
 * Every `parseMember` consumes at least one significant token, so the loop
 * always terminates.
 */
function parseBlockBody(cursor: Cursor, parseMember: MemberParser): void {
  const braceMark = cursor.mark();
  cursor.bump(); // LBrace
  for (;;) {
    const kind = cursor.peekKind();
    if (kind === 'RBrace' || kind === 'Eof') break;
    parseMember(cursor);
  }
  if (cursor.peekKind() === 'RBrace') {
    cursor.bump();
  } else {
    cursor.diagnostic('PSL_UNTERMINATED_BLOCK', 'Unterminated block declaration', braceMark);
  }
}

function parseUnsupportedTopLevel(cursor: Cursor): void {
  const offending = cursor.peekToken().text;
  const message =
    cursor.peekKind(1) === 'LBrace'
      ? `Unsupported top-level block "${offending}"`
      : `Unsupported top-level declaration "${offending}"`;
  cursor.diagnostic('PSL_UNSUPPORTED_TOP_LEVEL_BLOCK', message, cursor.mark());
  cursor.bump();
  cursor.recoverToSyncPoint();
}

/**
 * Block-attribute alternative shared by model and enum members: matches a
 * leading `@@` (yielding a `ModelAttribute`) and is a no-op on anything else. The
 * `@@`-vs-`@` distinction is preserved exactly — single-`@` attributes belong to
 * fields and enum values and are parsed inside `parseField`/`parseEnumValue`.
 */
export function parseBlockAttribute(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'DoubleAt') return undefined;
  return parseAttribute(cursor);
}

function parseModelMember(cursor: Cursor): void {
  const node = parseBlockAttribute(cursor) ?? parseField(cursor);
  if (!node) {
    invalidMember(
      cursor,
      'PSL_INVALID_MODEL_MEMBER',
      `Invalid model member declaration "${cursor.peekToken().text}"`,
    );
  }
}

function parseEnumMember(cursor: Cursor): void {
  const node = parseBlockAttribute(cursor) ?? parseEnumValue(cursor);
  if (!node) {
    invalidMember(
      cursor,
      'PSL_INVALID_ENUM_MEMBER',
      `Invalid enum value declaration "${cursor.peekToken().text}"`,
    );
  }
}

function parseNamedTypeMember(cursor: Cursor): void {
  const node = parseNamedType(cursor);
  if (!node) {
    invalidMember(
      cursor,
      'PSL_INVALID_TYPES_MEMBER',
      `Invalid types declaration "${cursor.peekToken().text}"`,
    );
  }
}

/**
 * A generic-block member is either a `@@`-block attribute (e.g. `@@type("…")`,
 * yielding a `ModelAttribute` — the same node model/enum/composite blocks use) or
 * a `key = value` entry. The block-attribute alternative is purely syntactic: it
 * parses the `@@attr(args)` shape and does not judge whether the attribute is
 * valid for the block's kind — that stays a `resolve` semantic concern.
 */
function parseKeyValueMember(cursor: Cursor): void {
  const node = parseBlockAttribute(cursor) ?? parseKeyValue(cursor);
  if (!node) {
    invalidMember(cursor, 'PSL_INVALID_EXTENSION_BLOCK_MEMBER', 'Invalid block entry');
  }
}

function invalidMember(cursor: Cursor, code: PslDiagnosticCode, message: string): void {
  cursor.diagnostic(code, message, cursor.mark());
  cursor.bump(); // consume the offending token so the member loop makes progress
  cursor.recoverToSyncPoint();
}

export function parseField(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'Ident') return undefined;
  cursor.startNode('FieldDeclaration');
  parseIdentifier(cursor); // name
  parseTypeAnnotation(cursor);
  while (cursor.peekKind() === 'At') {
    parseAttribute(cursor);
  }
  return cursor.finishNode();
}

export function parseEnumValue(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'Ident') return undefined;
  cursor.startNode('EnumValueDeclaration');
  parseIdentifier(cursor); // name
  while (cursor.peekKind() === 'At') {
    parseAttribute(cursor);
  }
  return cursor.finishNode();
}

export function parseNamedType(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'Ident') return undefined;
  cursor.startNode('NamedTypeDeclaration');
  const nameMark = cursor.mark();
  const nameText = cursor.peekToken().text;
  parseIdentifier(cursor); // name
  if (cursor.peekKind() === 'Equals') {
    cursor.bump();
  } else {
    cursor.diagnostic('PSL_INVALID_TYPES_MEMBER', `Expected "=" after "${nameText}"`, nameMark);
  }
  parseTypeAnnotation(cursor);
  while (cursor.peekKind() === 'At') {
    parseAttribute(cursor);
  }
  return cursor.finishNode();
}

export function parseKeyValue(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'Ident') return undefined;
  cursor.startNode('KeyValuePair');
  const keyMark = cursor.mark();
  const keyText = cursor.peekToken().text;
  parseIdentifier(cursor); // key
  if (cursor.peekKind() === 'Equals') {
    cursor.bump();
  } else {
    cursor.diagnostic(
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
      `Expected "=" after "${keyText}"`,
      keyMark,
    );
  }
  parseExpression(cursor);
  return cursor.finishNode();
}
