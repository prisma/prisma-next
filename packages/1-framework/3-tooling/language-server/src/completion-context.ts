import {
  AttributeArgListAst,
  CompositeTypeDeclarationAst,
  type DocumentAst,
  FieldAttributeAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
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

export interface ModelTypeCompletionContext {
  readonly kind: 'modelType';
  readonly offset: number;
  readonly fieldName: string;
  readonly replacementStartOffset: number;
}

export interface SpaceMemberCompletionContext {
  readonly kind: 'spaceMember';
  readonly offset: number;
  readonly fieldName: string;
  readonly replacementStartOffset: number;
  readonly space: string;
}

export interface NamespaceMemberCompletionContext {
  readonly kind: 'namespaceMember';
  readonly offset: number;
  readonly fieldName: string;
  readonly replacementStartOffset: number;
  readonly namespace: string;
}

export interface GenericBlockKeyCompletionContext {
  readonly kind: 'genericBlockKey';
  readonly offset: number;
  readonly blockKeyword: string;
  readonly replacementStartOffset: number;
  readonly existingParameterNames: readonly string[];
}

export interface GenericBlockValueCompletionContext {
  readonly kind: 'genericBlockValue';
  readonly offset: number;
  readonly blockKeyword: string;
  readonly replacementStartOffset: number;
}

export type DeclarationKeywordCompletionScope = 'document' | 'namespace';

export interface DeclarationKeywordCompletionContext {
  readonly kind: 'declarationKeyword';
  readonly offset: number;
  readonly scope: DeclarationKeywordCompletionScope;
  readonly replacementStartOffset: number;
}

export interface UnsupportedPslCompletionContext {
  readonly kind: 'unsupported';
  readonly offset: number;
}

export type PslCompletionContext =
  | DeclarationKeywordCompletionContext
  | GenericBlockKeyCompletionContext
  | GenericBlockValueCompletionContext
  | ModelTypeCompletionContext
  | NamespaceMemberCompletionContext
  | SpaceMemberCompletionContext
  | UnsupportedPslCompletionContext;

export function classifyPslCompletionContext(
  input: ClassifyPslCompletionContextInput,
): PslCompletionContext {
  const root = input.document.syntax;
  const offset = input.sourceFile.offsetAt(input.position);
  const at = root.tokenAtOffset(offset);
  if (at.rightBiased()?.kind === 'Comment' || at.leftBiased()?.kind === 'Comment') {
    return unsupported(offset);
  }

  // Anchor on the token left of the cursor and navigate outward via
  // `token.parent` rather than scanning the whole tree.
  const anchorNode = at.leftBiased()?.parent;
  const previousSignificantNode = previousSignificantToken(at, offset)?.parent;
  const contextNode = nodeForContext(anchorNode, previousSignificantNode);
  if (hasUnsupportedAncestor(contextNode)) {
    return unsupported(offset);
  }

  // The edit replaces the identifier under the cursor, or is empty when the
  // cursor sits in trivia.
  const replacementStartOffset = sourceRangeStart(at, offset);

  const declarationKeywordContext = classifyDeclarationKeyword({
    node: contextNode,
    offset,
    at,
    replacementStartOffset,
  });
  if (declarationKeywordContext !== undefined) {
    return declarationKeywordContext;
  }

  const genericBlockContext = classifyGenericBlockParameter({
    node: contextNode,
    offset,
    at,
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
  if (fieldName === undefined) {
    return unsupported(input.offset);
  }
  const fieldNameText = fieldName.name();
  if (fieldNameText === undefined) {
    return unsupported(input.offset);
  }

  const fieldNameEnd = fieldName.syntax.endOffset;

  if (fieldName.syntax.isInside(input.offset)) {
    return unsupported(input.offset);
  }

  const typeAnnotation = input.field.typeAnnotation();
  if (typeAnnotation === undefined) {
    return unsupported(input.offset);
  }

  const typeStart = typeAnnotation.syntax.offset;

  if (typeAnnotation.syntax.textLength === 0) {
    const fieldNameToken = fieldName.syntax.lastToken;
    if (
      fieldNameToken !== undefined &&
      input.offset > fieldNameEnd &&
      input.offset <= typeStart &&
      onlyWhitespaceBetween(fieldNameToken, input.offset)
    ) {
      return modelType(input.offset, fieldNameText, input.offset);
    }
    return unsupported(input.offset);
  }

  if (typeAnnotation.syntax.isOutside(input.offset)) {
    return unsupported(input.offset);
  }

  const constructorArgList = typeAnnotation.argList();
  if (constructorArgList?.syntax.isInside(input.offset)) {
    return unsupported(input.offset);
  }

  const name = typeAnnotation.name();
  if (name === undefined) {
    return unsupported(input.offset);
  }
  if (name.syntax.isOutside(input.offset)) {
    return unsupported(input.offset);
  }
  if (name.isOverQualified()) {
    return unsupported(input.offset);
  }

  const position = classifyTypePosition(name);
  if (position === undefined) {
    return unsupported(input.offset);
  }

  switch (position.kind) {
    case 'modelType':
      return modelType(input.offset, fieldNameText, input.replacementStartOffset);
    case 'spaceMember':
      return spaceMember(input.offset, fieldNameText, input.replacementStartOffset, position.space);
    case 'namespaceMember':
      return namespaceMember(
        input.offset,
        fieldNameText,
        input.replacementStartOffset,
        position.namespace,
      );
  }
}

type TypePosition =
  | { readonly kind: 'modelType' }
  | { readonly kind: 'spaceMember'; readonly space: string }
  | { readonly kind: 'namespaceMember'; readonly namespace: string };

/**
 * Resolves which type-completion position a qualified name sits in, gating on
 * the same separator validity as the name itself: a `:` requires a contract-
 * space segment and a `.` requires a namespace segment. A failed gate yields
 * `undefined` (the caller maps it to `unsupported`).
 *
 * Behaviour change: a `:`-qualified name with no `.` (e.g. `supabase:`,
 * `supabase:U`) is now a `spaceMember` position rather than falling through to
 * bare model-type completions.
 */
function classifyTypePosition(name: QualifiedNameAst): TypePosition | undefined {
  if (name.colon() !== undefined) {
    const space = name.space()?.name();
    if (space === undefined || space.length === 0) return undefined;
    if (name.dot() === undefined) return { kind: 'spaceMember', space };
    const namespace = name.namespace()?.name();
    if (namespace === undefined || namespace.length === 0) return undefined;
    return { kind: 'namespaceMember', namespace };
  }
  if (name.dot() !== undefined) {
    const namespace = name.namespace()?.name();
    if (namespace === undefined || namespace.length === 0) return undefined;
    return { kind: 'namespaceMember', namespace };
  }
  return { kind: 'modelType' };
}

function modelType(
  offset: number,
  fieldName: string,
  replacementStartOffset: number,
): ModelTypeCompletionContext {
  return { kind: 'modelType', offset, fieldName, replacementStartOffset };
}

function spaceMember(
  offset: number,
  fieldName: string,
  replacementStartOffset: number,
  space: string,
): SpaceMemberCompletionContext {
  return { kind: 'spaceMember', offset, fieldName, replacementStartOffset, space };
}

function namespaceMember(
  offset: number,
  fieldName: string,
  replacementStartOffset: number,
  namespace: string,
): NamespaceMemberCompletionContext {
  return { kind: 'namespaceMember', offset, fieldName, replacementStartOffset, namespace };
}

function classifyDeclarationKeyword(input: {
  readonly node: SyntaxNode | undefined;
  readonly offset: number;
  readonly at: TokenAtOffset;
  readonly replacementStartOffset: number;
}): DeclarationKeywordCompletionContext | undefined {
  if (isInsideNonDeclarationKeywordBody(input.node, input.offset)) {
    return undefined;
  }

  const namespace = closestAst(input.node, NamespaceDeclarationAst.cast);
  const scope = namespaceBodyContainsOffset(namespace, input.offset) ? 'namespace' : 'document';

  const prefixToken = cursorIdentifier(input.at, input.offset);
  if (!declarationKeywordAllowed(prefixToken, namespace, input)) {
    return undefined;
  }

  return {
    kind: 'declarationKeyword',
    offset: input.offset,
    scope,
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
  input: { readonly offset: number; readonly at: TokenAtOffset },
): boolean {
  const previous =
    prefixToken !== undefined
      ? previousNonTriviaToken(prefixToken)
      : previousSignificantToken(input.at, input.offset);
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
  const bodyEnd = rbrace?.offset ?? declaration.syntax.endOffset;
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
  const bodyEnd = rbrace?.offset ?? namespace.syntax.endOffset;
  return offset >= bodyStart && offset <= bodyEnd;
}

function classifyGenericBlockParameter(input: {
  readonly node: SyntaxNode | undefined;
  readonly offset: number;
  readonly at: TokenAtOffset;
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
  if (field?.syntax.isInside(input.offset)) {
    return unsupported(input.offset);
  }

  const keyword = block.keyword()?.text;
  if (keyword === undefined || keyword.length === 0) {
    return unsupported(input.offset);
  }

  // Value position: the cursor follows a `=`. The position is now classified
  // distinctly from keys; populating value candidates is the provider's concern.
  if (previousSignificantToken(input.at, input.offset)?.kind === 'Equals') {
    return {
      kind: 'genericBlockValue',
      offset: input.offset,
      blockKeyword: keyword,
      replacementStartOffset: input.replacementStartOffset,
    };
  }

  const activePair = activeKeyValuePair(input.node, input.offset);
  if (activePair !== undefined && isAfterEquals(activePair, input.offset)) {
    return unsupported(input.offset);
  }

  return {
    kind: 'genericBlockKey',
    offset: input.offset,
    blockKeyword: keyword,
    replacementStartOffset: input.replacementStartOffset,
    existingParameterNames: existingParameterNames(block, activePair),
  };
}

function activeKeyValuePair(
  node: SyntaxNode | undefined,
  offset: number,
): KeyValuePairAst | undefined {
  const pair = closestAst(node, KeyValuePairAst.cast);
  if (pair === undefined || pair.syntax.isOutside(offset)) {
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

/** The nearest non-trivia token ending at or before the cursor. */
function previousSignificantToken(at: TokenAtOffset, offset: number): SyntaxToken | undefined {
  const left = at.leftBiased();
  if (left === undefined) {
    return undefined;
  }
  return tokenEndOffset(left) <= offset && !isTrivia(left) ? left : previousNonTriviaToken(left);
}

/** The identifier token the cursor is editing, if any. */
function cursorIdentifier(at: TokenAtOffset, offset: number): SyntaxToken | undefined {
  const right = at.rightBiased();
  if (right?.kind === 'Ident' && offset < tokenEndOffset(right)) {
    return right;
  }
  const left = at.leftBiased();
  if (left?.kind === 'Ident' && tokenEndOffset(left) === offset) {
    return left;
  }
  return undefined;
}

function sourceRangeStart(at: TokenAtOffset, offset: number): number {
  return cursorIdentifier(at, offset)?.offset ?? offset;
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

function tokenEndOffset(token: SyntaxToken): number {
  return token.offset + token.text.length;
}
