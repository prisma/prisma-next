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

  mark(): DiagnosticMark {
    let rawIndex = 0;
    let offset = this.#offset;
    for (;;) {
      const token = this.#tokenizer.peek(rawIndex);
      if (token.kind === 'Eof' || !TRIVIA_KINDS.has(token.kind)) {
        return { offset, length: token.text.length };
      }
      offset += token.text.length;
      rawIndex++;
    }
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

  captureBalancedBraces(): void {
    this.flushTrivia();
    let depth = 0;
    for (;;) {
      const token = this.#tokenizer.peek();
      if (token.kind === 'Eof') return;
      this.#builder.token(token.kind, token.text);
      this.#advance();
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
 * recognised expression (the caller decides how to recover — e.g. capturing a
 * `{…}` object literal as balanced raw tokens).
 */
export function parseExpression(cursor: Cursor): GreenNode | undefined {
  return (
    parseStringLiteralExpr(cursor) ??
    parseNumberLiteralExpr(cursor) ??
    parseArrayLiteral(cursor) ??
    parseFunctionCall(cursor) ??
    parseBooleanLiteralExpr(cursor) ??
    parseIdentifierExpr(cursor)
  );
}

export function parseStringLiteralExpr(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'StringLiteral') return undefined;
  cursor.startNode('StringLiteralExpr');
  cursor.bump();
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

export function parseFunctionCall(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'Ident' || cursor.peekKind(1) !== 'LParen') return undefined;
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
  const value = parseExpression(cursor);
  if (!value && cursor.peekKind() === 'LBrace') {
    // No SyntaxKind models an object literal; capture it as balanced raw tokens
    // so the round-trip still holds and the value is simply left uninterpreted.
    cursor.captureBalancedBraces();
  }
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
  const node =
    parseModel(cursor) ??
    parseEnum(cursor) ??
    parseNamespace(cursor, insideNamespace) ??
    parseTypeDeclaration(cursor, insideNamespace) ??
    parseGenericBlock(cursor);
  if (!node) {
    parseUnsupportedTopLevel(cursor);
  }
}

/**
 * After a reserved declaration keyword has committed, completes the header: it
 * parses the block body when the opening brace is present, otherwise emits a
 * single keyword-anchored `PSL_INVALID_DECLARATION` and recovers to the next
 * sync point. The diagnostic reports the first missing piece — a missing name
 * takes precedence over a missing brace — so at most one is emitted per
 * malformed header.
 */
function finishReservedHeader(
  cursor: Cursor,
  keyword: string,
  keywordMark: DiagnosticMark,
  hasName: boolean,
  parseBody: () => void,
): void {
  const hasBrace = cursor.peekKind() === 'LBrace';
  if (!hasName) {
    cursor.diagnostic('PSL_INVALID_DECLARATION', `Expected a name after "${keyword}"`, keywordMark);
  } else if (!hasBrace) {
    cursor.diagnostic(
      'PSL_INVALID_DECLARATION',
      `Expected "{" to open the "${keyword}" block`,
      keywordMark,
    );
  }
  if (hasBrace) {
    parseBody();
  } else {
    cursor.recoverToSyncPoint();
  }
}

/**
 * Parses a reserved block declaration (`model`/`enum`, or the composite-type
 * branch of `type`) whose keyword has already been matched. The keyword commits
 * the declaration kind: an optional name is parsed when present, then the header
 * is completed by `finishReservedHeader`, which flags a missing name or brace.
 */
function parseReservedBlock(
  cursor: Cursor,
  keyword: string,
  kind: SyntaxKind,
  parseMember: MemberParser,
): GreenNode {
  const keywordMark = cursor.mark();
  cursor.startNode(kind);
  cursor.bump(); // keyword
  const hasName = cursor.peekKind() === 'Ident';
  if (hasName) {
    parseIdentifier(cursor);
  }
  finishReservedHeader(cursor, keyword, keywordMark, hasName, () =>
    parseBlockBody(cursor, parseMember),
  );
  return cursor.finishNode();
}

export function parseModel(cursor: Cursor): GreenNode | undefined {
  if (!keywordIs(cursor, 'model')) return undefined;
  return parseReservedBlock(cursor, 'model', 'ModelDeclaration', parseModelMember);
}

export function parseEnum(cursor: Cursor): GreenNode | undefined {
  if (!keywordIs(cursor, 'enum')) return undefined;
  return parseReservedBlock(cursor, 'enum', 'EnumDeclaration', parseEnumMember);
}

/**
 * Matches an unreserved `Ident` block keyword followed by `{` (anonymous) or
 * `Ident {` (named). Excluding the reserved keywords (`model`/`enum`/
 * `namespace`/`type`) is what keeps a malformed reserved block (e.g. `model {`
 * with no name) routed to its dedicated parser — which commits the declaration
 * kind on the keyword and reports a `PSL_INVALID_DECLARATION` — rather than
 * being captured here as a generic block. Generic blocks carry no reserved
 * keyword (the set is open for extension-contributed blocks), so they stay
 * discriminated by the opening brace.
 */
export function parseGenericBlock(cursor: Cursor): GreenNode | undefined {
  if (cursor.peekKind() !== 'Ident') return undefined;
  if (RESERVED_BLOCK_KEYWORDS.has(cursor.peekToken().text)) return undefined;
  const hasName = cursor.peekKind(1) === 'Ident' && cursor.peekKind(2) === 'LBrace';
  if (!hasName && cursor.peekKind(1) !== 'LBrace') return undefined;
  cursor.startNode('BlockDeclaration');
  cursor.bump(); // keyword
  if (hasName) {
    parseIdentifier(cursor);
  }
  parseBlockBody(cursor, parseKeyValueMember);
  return cursor.finishNode();
}

export function parseNamespace(cursor: Cursor, insideNamespace: boolean): GreenNode | undefined {
  if (!keywordIs(cursor, 'namespace')) return undefined;
  const keywordMark = cursor.mark();
  cursor.startNode('Namespace');
  cursor.bump(); // namespace
  const hasName = cursor.peekKind() === 'Ident';
  const name = hasName ? cursor.peekToken().text : '';
  if (hasName) {
    parseIdentifier(cursor);
  }
  if (insideNamespace) {
    cursor.diagnostic(
      'PSL_INVALID_NAMESPACE_BLOCK',
      `Recursive "namespace ${name}" block is not allowed; namespace blocks may not nest`,
      keywordMark,
    );
  } else if (name === UNSPECIFIED_PSL_NAMESPACE_ID) {
    cursor.diagnostic(
      'PSL_INVALID_NAMESPACE_BLOCK',
      `Namespace name "${UNSPECIFIED_PSL_NAMESPACE_ID}" is reserved for the parser-synthesised bucket for top-level declarations`,
      keywordMark,
    );
  }
  finishReservedHeader(cursor, 'namespace', keywordMark, hasName, () =>
    parseBlockBody(cursor, (inner) => parseDeclaration(inner, true)),
  );
  return cursor.finishNode();
}

/**
 * Parses a `type` declaration. The keyword commits the declaration to one of two
 * kinds, disambiguated by the next significant token: a following `Ident` is a
 * composite type (`type Name { … }`), anything else is a `types` block
 * (`type { … }`). Either branch commits the kind on the keyword — a missing
 * brace (or, for the composite branch, a present name with no brace) yields a
 * `PSL_INVALID_DECLARATION`, not an unsupported-declaration. The `types` branch
 * preserves the document-top-level constraint.
 */
export function parseTypeDeclaration(
  cursor: Cursor,
  insideNamespace: boolean,
): GreenNode | undefined {
  if (!keywordIs(cursor, 'type')) return undefined;
  if (cursor.peekKind(1) === 'Ident') {
    return parseReservedBlock(cursor, 'type', 'CompositeTypeDeclaration', parseModelMember);
  }
  const keywordMark = cursor.mark();
  cursor.startNode('TypesBlock');
  if (insideNamespace) {
    cursor.diagnostic(
      'PSL_INVALID_NAMESPACE_BLOCK',
      '`types` blocks must be declared at the document top level, not inside a namespace block',
      keywordMark,
    );
  }
  cursor.bump(); // type
  if (cursor.peekKind() === 'LBrace') {
    parseBlockBody(cursor, parseNamedTypeMember);
  } else {
    cursor.diagnostic(
      'PSL_INVALID_DECLARATION',
      'Expected "{" to open the "type" block',
      keywordMark,
    );
    cursor.recoverToSyncPoint();
  }
  return cursor.finishNode();
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

function parseKeyValueMember(cursor: Cursor): void {
  const node = parseKeyValue(cursor);
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
  parseIdentifier(cursor); // name
  if (cursor.peekKind() === 'Equals') {
    cursor.bump();
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
  parseIdentifier(cursor); // key
  if (cursor.peekKind() === 'Equals') {
    cursor.bump();
  }
  const value = parseExpression(cursor);
  if (!value && cursor.peekKind() === 'LBrace') {
    cursor.captureBalancedBraces();
  }
  return cursor.finishNode();
}
