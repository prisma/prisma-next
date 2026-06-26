import {
  AttributeArgListAst,
  CompositeTypeDeclarationAst,
  type DocumentAst,
  FieldAttributeAst,
  FieldDeclarationAst,
  filterChildren,
  GenericBlockDeclarationAst,
  IdentifierAst,
  isTrivia,
  KeyValuePairAst,
  ModelAttributeAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
  type Position,
  previousNonTriviaToken,
  type QualifiedNameAst,
  type SourceFile,
  type SyntaxNode,
  type SyntaxToken,
  type TokenAtOffset,
  TypesBlockAst,
} from '@prisma-next/psl-parser/syntax';

export interface ClassifyPslCompletionContextInput {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly position: Position;
}

export interface TypeNamePrefix {
  readonly path: readonly string[];
  readonly contractSpace?: string;
  readonly namespace?: string;
  readonly name: string;
}

export interface ModelFieldTypeCompletionContext {
  readonly kind: 'modelFieldType';
  readonly offset: number;
  readonly fieldName: string;
  readonly prefix: TypeNamePrefix;
  readonly replacementStartOffset: number;
}

export interface GenericBlockParameterCompletionContext {
  readonly kind: 'genericBlockParameter';
  readonly offset: number;
  readonly blockKeyword: string;
  readonly prefix: string;
  readonly replacementStartOffset: number;
  readonly existingParameterNames: readonly string[];
}

export type DeclarationKeywordCompletionScope = 'document' | 'namespace';

export interface DeclarationKeywordCompletionContext {
  readonly kind: 'declarationKeyword';
  readonly offset: number;
  readonly scope: DeclarationKeywordCompletionScope;
  readonly prefix: string;
  readonly replacementStartOffset: number;
}

export interface UnsupportedPslCompletionContext {
  readonly kind: 'unsupported';
  readonly offset: number;
}

export type PslCompletionContext =
  | DeclarationKeywordCompletionContext
  | GenericBlockParameterCompletionContext
  | ModelFieldTypeCompletionContext
  | UnsupportedPslCompletionContext;

interface TokenContext {
  readonly current: SyntaxToken | undefined;
  readonly previousSignificant: SyntaxToken | undefined;
  readonly touching: SyntaxToken | undefined;
}

export function classifyPslCompletionContext(
  input: ClassifyPslCompletionContextInput,
): PslCompletionContext {
  const root = input.document.syntax;
  const offset = input.sourceFile.offsetAt(input.position);
  const at = root.tokenAtOffset(offset);
  const tokenContext = tokenContextAt(at, offset);
  if (tokenContext.current?.kind === 'Comment' || tokenContext.touching?.kind === 'Comment') {
    return unsupported(offset);
  }

  // Anchor on the token left of the cursor and navigate outward via
  // `token.parent` rather than scanning the whole tree.
  const anchorNode = at.leftBiased()?.parent;
  const previousSignificantNode = tokenContext.previousSignificant?.parent;
  const contextNode = nodeForContext(anchorNode, previousSignificantNode);
  if (hasUnsupportedAncestor(contextNode)) {
    return unsupported(offset);
  }

  // The edit replaces the identifier under the cursor, or is empty when the
  // cursor sits in trivia.
  const replacementStartOffset = sourceRangeStart(tokenContext, offset);

  const declarationKeywordContext = classifyDeclarationKeyword({
    node: contextNode,
    offset,
    source: input.sourceFile.text,
    tokenContext,
    replacementStartOffset,
  });
  if (declarationKeywordContext !== undefined) {
    return declarationKeywordContext;
  }

  const genericBlockContext = classifyGenericBlockParameter({
    node: contextNode,
    offset,
    source: input.sourceFile.text,
    tokenContext,
    replacementStartOffset,
  });
  if (genericBlockContext !== undefined) {
    return genericBlockContext;
  }

  const field = closestAst(contextNode, FieldDeclarationAst.cast);
  if (field === undefined) {
    return unsupported(offset);
  }
  if (closestAst(field.syntax, ModelDeclarationAst.cast) === undefined) {
    return unsupported(offset);
  }

  return classifyModelFieldType({
    field,
    offset,
    replacementStartOffset,
  });
}

function classifyModelFieldType(input: {
  readonly field: FieldDeclarationAst;
  readonly offset: number;
  readonly replacementStartOffset: number;
}): PslCompletionContext {
  const fieldName = input.field.name();
  const fieldNameText = fieldName?.name();
  if (fieldName === undefined || fieldNameText === undefined) {
    return unsupported(input.offset);
  }

  const fieldNameStart = fieldName.syntax.offset;
  const fieldNameEnd = endOffset(fieldName.syntax);
  if (input.offset >= fieldNameStart && input.offset <= fieldNameEnd) {
    return unsupported(input.offset);
  }

  const typeAnnotation = input.field.typeAnnotation();
  if (typeAnnotation === undefined) {
    return unsupported(input.offset);
  }

  const typeStart = typeAnnotation.syntax.offset;
  const typeEnd = endOffset(typeAnnotation.syntax);
  if (typeAnnotation.syntax.textLength === 0) {
    const fieldNameToken = fieldName.syntax.lastToken;
    if (
      fieldNameToken !== undefined &&
      input.offset > fieldNameEnd &&
      input.offset <= typeStart &&
      onlyWhitespaceBetween(fieldNameToken, input.offset)
    ) {
      return modelFieldType(input.offset, fieldNameText, { path: [], name: '' }, input.offset);
    }
    return unsupported(input.offset);
  }

  if (input.offset < typeStart || input.offset > typeEnd) {
    return unsupported(input.offset);
  }

  const constructorArgList = typeAnnotation.argList();
  if (constructorArgList !== undefined && containsOffset(constructorArgList.syntax, input.offset)) {
    return unsupported(input.offset);
  }

  const name = typeAnnotation.name();
  if (name === undefined) {
    return unsupported(input.offset);
  }
  if (!containsOffset(name.syntax, input.offset)) {
    return unsupported(input.offset);
  }
  if (name.isOverQualified()) {
    return unsupported(input.offset);
  }

  const prefix = typeNamePrefix(name, input.offset);
  if (prefix === undefined) {
    return unsupported(input.offset);
  }

  return modelFieldType(input.offset, fieldNameText, prefix, input.replacementStartOffset);
}

function modelFieldType(
  offset: number,
  fieldName: string,
  prefix: TypeNamePrefix,
  replacementStartOffset: number,
): ModelFieldTypeCompletionContext {
  return { kind: 'modelFieldType', offset, fieldName, prefix, replacementStartOffset };
}

function classifyDeclarationKeyword(input: {
  readonly node: SyntaxNode | undefined;
  readonly offset: number;
  readonly source: string;
  readonly tokenContext: TokenContext;
  readonly replacementStartOffset: number;
}): DeclarationKeywordCompletionContext | undefined {
  if (isInsideNonDeclarationKeywordBody(input.node, input.offset)) {
    return undefined;
  }

  const namespace = closestAst(input.node, NamespaceDeclarationAst.cast);
  const scope = namespaceBodyContainsOffset(namespace, input.offset) ? 'namespace' : 'document';

  const prefixToken = cursorIdentifier(input.tokenContext, input.offset);
  if (!declarationKeywordAllowed(prefixToken, namespace, input)) {
    return undefined;
  }

  return {
    kind: 'declarationKeyword',
    offset: input.offset,
    scope,
    prefix: input.source.slice(input.replacementStartOffset, input.offset),
    replacementStartOffset: input.replacementStartOffset,
  };
}

/**
 * A declaration keyword may be completed only when nothing but whitespace
 * precedes the cursor on its line — i.e. the previous significant token is on an
 * earlier line, is absent, or is the enclosing namespace's opening brace.
 */
function declarationKeywordAllowed(
  prefixToken: SyntaxToken | undefined,
  namespace: NamespaceDeclarationAst | undefined,
  input: { readonly offset: number; readonly tokenContext: TokenContext },
): boolean {
  const previous =
    prefixToken !== undefined
      ? previousNonTriviaToken(prefixToken)
      : input.tokenContext.previousSignificant;
  if (previous === undefined) {
    return true;
  }

  const start = prefixToken?.offset ?? input.offset;
  if (newlineBetween(previous, start)) {
    return true;
  }

  const lbrace = namespace?.lbrace();
  return lbrace !== undefined && lbrace.offset === previous.offset;
}

function isInsideNonDeclarationKeywordBody(node: SyntaxNode | undefined, offset: number): boolean {
  return (
    declarationBodyContainsOffset(closestAst(node, ModelDeclarationAst.cast), offset) ||
    declarationBodyContainsOffset(closestAst(node, CompositeTypeDeclarationAst.cast), offset) ||
    declarationBodyContainsOffset(closestAst(node, TypesBlockAst.cast), offset) ||
    declarationBodyContainsOffset(closestAst(node, GenericBlockDeclarationAst.cast), offset)
  );
}

function declarationBodyContainsOffset(
  declaration:
    | CompositeTypeDeclarationAst
    | GenericBlockDeclarationAst
    | ModelDeclarationAst
    | TypesBlockAst
    | undefined,
  offset: number,
): boolean {
  if (declaration === undefined) {
    return false;
  }
  const lbrace = declaration.lbrace();
  if (lbrace === undefined) {
    return false;
  }
  const bodyStart = lbrace.offset + lbrace.text.length;
  const rbrace = declaration.rbrace();
  const bodyEnd = rbrace?.offset ?? endOffset(declaration.syntax);
  return offset >= bodyStart && offset <= bodyEnd;
}

function namespaceBodyContainsOffset(
  namespace: NamespaceDeclarationAst | undefined,
  offset: number,
): boolean {
  if (namespace === undefined) {
    return false;
  }
  const lbrace = namespace.lbrace();
  if (lbrace === undefined) {
    return false;
  }
  const bodyStart = lbrace.offset + lbrace.text.length;
  const rbrace = namespace.rbrace();
  const bodyEnd = rbrace?.offset ?? endOffset(namespace.syntax);
  return offset >= bodyStart && offset <= bodyEnd;
}

function classifyGenericBlockParameter(input: {
  readonly node: SyntaxNode | undefined;
  readonly offset: number;
  readonly source: string;
  readonly tokenContext: TokenContext;
  readonly replacementStartOffset: number;
}): PslCompletionContext | undefined {
  const block = closestAst(input.node, GenericBlockDeclarationAst.cast);
  if (block === undefined) {
    return undefined;
  }

  const lbrace = block.lbrace();
  if (lbrace === undefined || input.offset < lbrace.offset + lbrace.text.length) {
    return unsupported(input.offset);
  }

  const rbrace = block.rbrace();
  if (rbrace !== undefined && input.offset > rbrace.offset) {
    return unsupported(input.offset);
  }

  const field = closestAst(input.node, FieldDeclarationAst.cast);
  if (field !== undefined && containsOffset(field.syntax, input.offset)) {
    return unsupported(input.offset);
  }

  if (input.tokenContext.previousSignificant?.kind === 'Equals') {
    return unsupported(input.offset);
  }

  const keyword = block.keyword()?.text;
  if (keyword === undefined || keyword.length === 0) {
    return unsupported(input.offset);
  }

  const activePair = activeKeyValuePair(input.node, input.offset);
  if (activePair !== undefined && isAfterEquals(activePair, input.offset)) {
    return unsupported(input.offset);
  }

  return {
    kind: 'genericBlockParameter',
    offset: input.offset,
    blockKeyword: keyword,
    prefix: input.source.slice(input.replacementStartOffset, input.offset),
    replacementStartOffset: input.replacementStartOffset,
    existingParameterNames: existingParameterNames(block, activePair),
  };
}

function activeKeyValuePair(
  node: SyntaxNode | undefined,
  offset: number,
): KeyValuePairAst | undefined {
  const pair = closestAst(node, KeyValuePairAst.cast);
  if (pair === undefined || !containsOffset(pair.syntax, offset)) {
    return undefined;
  }
  return pair;
}

function isAfterEquals(pair: KeyValuePairAst, offset: number): boolean {
  const equals = pair.equals();
  return equals !== undefined && offset > equals.offset;
}

function existingParameterNames(
  block: GenericBlockDeclarationAst,
  activePair: KeyValuePairAst | undefined,
): readonly string[] {
  const names: string[] = [];
  for (const entry of block.entries()) {
    if (activePair !== undefined && sameSpan(entry.syntax, activePair.syntax)) {
      continue;
    }
    const name = entry.key()?.name();
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

function sameSpan(left: SyntaxNode, right: SyntaxNode): boolean {
  return left.offset === right.offset && left.textLength === right.textLength;
}

function unsupported(offset: number): UnsupportedPslCompletionContext {
  return { kind: 'unsupported', offset };
}

function hasUnsupportedAncestor(node: SyntaxNode | undefined): boolean {
  return (
    closestAst(node, AttributeArgListAst.cast) !== undefined ||
    closestAst(node, FieldAttributeAst.cast) !== undefined ||
    closestAst(node, ModelAttributeAst.cast) !== undefined
  );
}

/**
 * Derives the qualified type-name prefix purely from the {@link QualifiedNameAst}
 * segments and its `:` / `.` separator tokens, relative to the cursor. A
 * separator counts only when it lies before the cursor, so structure is decided
 * by what the user has actually typed: in `space:auth.User` the namespace role
 * appears only once the cursor passes the dot. The single source touch is
 * slicing the cursor segment's own identifier-token text.
 */
function typeNamePrefix(name: QualifiedNameAst, offset: number): TypeNamePrefix | undefined {
  const cursor = Math.min(offset, endOffset(name.syntax));
  const segments = Array.from(filterChildren(name.syntax, IdentifierAst.cast));

  const colon = name.colon();
  const dot = name.dot();
  const colonOffset = colon !== undefined && colon.offset < cursor ? colon.offset : undefined;
  const dotOffset = dot !== undefined && dot.offset < cursor ? dot.offset : undefined;

  const contractSpaceSegment =
    colonOffset === undefined ? undefined : lastSegmentBefore(segments, colonOffset);
  const namespaceSegment =
    dotOffset === undefined ? undefined : lastSegmentBetween(segments, colonOffset, dotOffset);
  const lastSeparatorOffset = dotOffset ?? colonOffset;
  const nameSegment = firstSegmentAfter(segments, lastSeparatorOffset, cursor);

  const contractSpace = colonOffset === undefined ? undefined : contractSpaceSegment?.name();
  if (colonOffset !== undefined && (contractSpace === undefined || contractSpace.length === 0)) {
    return undefined;
  }
  const namespace = dotOffset === undefined ? undefined : namespaceSegment?.name();
  if (dotOffset !== undefined && (namespace === undefined || namespace.length === 0)) {
    return undefined;
  }

  const nameText = nameSegment === undefined ? '' : segmentTextBeforeCursor(nameSegment, cursor);
  const path = [contractSpace, namespace, nameText].filter(
    (segment): segment is string => segment !== undefined && segment.length > 0,
  );

  return {
    path,
    name: nameText,
    ...(contractSpace === undefined ? {} : { contractSpace }),
    ...(namespace === undefined ? {} : { namespace }),
  };
}

/** The last segment that starts strictly before `boundary`. */
function lastSegmentBefore(
  segments: readonly IdentifierAst[],
  boundary: number,
): IdentifierAst | undefined {
  let found: IdentifierAst | undefined;
  for (const segment of segments) {
    if (segment.syntax.offset >= boundary) break;
    found = segment;
  }
  return found;
}

/** The last segment that starts after `lowerBound` (if any) and before `upperBound`. */
function lastSegmentBetween(
  segments: readonly IdentifierAst[],
  lowerBound: number | undefined,
  upperBound: number,
): IdentifierAst | undefined {
  let found: IdentifierAst | undefined;
  for (const segment of segments) {
    const start = segment.syntax.offset;
    if (start >= upperBound) break;
    if (lowerBound !== undefined && start < lowerBound) continue;
    found = segment;
  }
  return found;
}

/** The first segment that starts after `boundary` and before the cursor. */
function firstSegmentAfter(
  segments: readonly IdentifierAst[],
  boundary: number | undefined,
  cursor: number,
): IdentifierAst | undefined {
  for (const segment of segments) {
    const start = segment.syntax.offset;
    if (boundary !== undefined && start <= boundary) continue;
    if (start >= cursor) continue;
    return segment;
  }
  return undefined;
}

/** The cursor segment's identifier text, truncated at the cursor. */
function segmentTextBeforeCursor(segment: IdentifierAst, cursor: number): string {
  const token = segment.token();
  if (token === undefined) return '';
  const take = cursor - token.offset;
  if (take <= 0) return '';
  return token.text.slice(0, Math.min(take, token.text.length));
}

function nodeForContext(
  node: SyntaxNode | undefined,
  previousNode: SyntaxNode | undefined,
): SyntaxNode | undefined {
  if (node === undefined || node.kind === 'Document' || node.kind === 'ModelDeclaration') {
    return previousNode ?? node;
  }
  return node;
}

function closestAst<T>(
  node: SyntaxNode | undefined,
  cast: (node: SyntaxNode) => T | undefined,
): T | undefined {
  if (node === undefined) {
    return undefined;
  }
  const current = cast(node);
  if (current !== undefined) {
    return current;
  }
  for (const ancestor of node.ancestors()) {
    const result = cast(ancestor);
    if (result !== undefined) return result;
  }
  return undefined;
}

function tokenContextAt(at: TokenAtOffset, offset: number): TokenContext {
  const left = at.leftBiased();
  const right = at.rightBiased();
  const current = right !== undefined && offset < tokenEndOffset(right) ? right : undefined;
  const touching = left !== undefined && tokenEndOffset(left) === offset ? left : undefined;
  let previousSignificant: SyntaxToken | undefined;
  if (left !== undefined) {
    previousSignificant =
      tokenEndOffset(left) <= offset && !isTrivia(left) ? left : previousNonTriviaToken(left);
  }
  return { current, previousSignificant, touching };
}

/** The identifier token the cursor is editing, if any. */
function cursorIdentifier(tokenContext: TokenContext, offset: number): SyntaxToken | undefined {
  if (tokenContext.current?.kind === 'Ident') {
    return tokenContext.current;
  }
  if (tokenContext.touching?.kind === 'Ident') {
    return tokenContext.touching;
  }
  const previous = tokenContext.previousSignificant;
  if (previous?.kind === 'Ident' && tokenEndOffset(previous) === offset) {
    return previous;
  }
  return undefined;
}

function sourceRangeStart(tokenContext: TokenContext, offset: number): number {
  return cursorIdentifier(tokenContext, offset)?.offset ?? offset;
}

/** Whether a newline trivia token separates `from` from `toOffset`. */
function newlineBetween(from: SyntaxToken, toOffset: number): boolean {
  for (let token = from.nextToken; token !== undefined && token.offset < toOffset; ) {
    if (token.kind === 'Newline') {
      return true;
    }
    token = token.nextToken;
  }
  return false;
}

/** Whether only whitespace trivia tokens lie between `from` and `toOffset`. */
function onlyWhitespaceBetween(from: SyntaxToken, toOffset: number): boolean {
  for (let token = from.nextToken; token !== undefined && token.offset < toOffset; ) {
    if (token.kind !== 'Whitespace') {
      return false;
    }
    token = token.nextToken;
  }
  return true;
}

function containsOffset(node: SyntaxNode, offset: number): boolean {
  const start = node.offset;
  const end = endOffset(node);
  return node.textLength === 0 ? offset === start : offset >= start && offset <= end;
}

function endOffset(node: SyntaxNode): number {
  return node.offset + node.textLength;
}

function tokenEndOffset(token: SyntaxToken): number {
  return token.offset + token.text.length;
}
