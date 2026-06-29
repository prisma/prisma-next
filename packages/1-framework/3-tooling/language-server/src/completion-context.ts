import {
  AttributeArgListAst,
  type BracedBlock,
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
  const contextNode = at.leftBiased()?.parent;

  // The edit replaces the identifier under the cursor, or is empty when the
  // cursor sits in trivia.
  const replacementStartOffset = cursorIdentifier(at, offset)?.offset ?? offset;

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
  if (
    closestAst(field.syntax, any(ModelDeclarationAst.cast, CompositeTypeDeclarationAst.cast)) ===
    undefined
  ) {
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
    if (input.offset > fieldNameEnd && input.offset <= typeStart) {
      return {
        kind: 'modelType',
        offset: input.offset,
        fieldName: fieldNameText,
        replacementStartOffset: input.offset,
      };
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

  return classifyTypePosition(name, input.offset, fieldNameText, input.replacementStartOffset);
}

/**
 * Builds the type-completion context for a qualified name. Roles are read
 * straight off the separator-positional accessors: a populated namespace
 * segment is a `.`-qualified name, a populated space segment is a `:`-qualified
 * name, and the absence of both is a bare model type.
 *
 * Behaviour change: a `:`-qualified name with no `.` (e.g. `supabase:`,
 * `supabase:U`) is a `spaceMember` position rather than falling through to bare
 * model-type completions. A malformed leading-separator name (`:User`, `.User`)
 * carries no populated segment and resolves to `modelType` rather than
 * `unsupported`.
 */
function classifyTypePosition(
  name: QualifiedNameAst,
  offset: number,
  fieldName: string,
  replacementStartOffset: number,
): ModelTypeCompletionContext | SpaceMemberCompletionContext | NamespaceMemberCompletionContext {
  const namespace = name.namespace()?.name();
  if (namespace !== undefined && namespace.length > 0) {
    return { kind: 'namespaceMember', offset, fieldName, replacementStartOffset, namespace };
  }
  const space = name.space()?.name();
  if (space !== undefined && space.length > 0) {
    return { kind: 'spaceMember', offset, fieldName, replacementStartOffset, space };
  }
  return { kind: 'modelType', offset, fieldName, replacementStartOffset };
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
  const scope = blockBodyContainsOffset(namespace, input.offset) ? 'namespace' : 'document';

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
 * A declaration keyword may be completed where a new declaration can begin: at
 * the start of the document or namespace body, immediately after a previous
 * declaration's closing `}`, or right after the enclosing namespace's opening
 * brace. Newlines are trivia and play no role — `model A {} model B {}` is valid
 * PSL on a single line.
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
  if (previous.kind === 'RBrace') {
    return true;
  }
  const lbrace = namespace?.lbrace();
  return lbrace !== undefined && lbrace.offset === previous.offset;
}

function isInsideNonDeclarationKeywordBody(node: SyntaxNode | undefined, offset: number): boolean {
  return blockBodyContainsOffset(
    closestAst(
      node,
      any(
        ModelDeclarationAst.cast,
        CompositeTypeDeclarationAst.cast,
        TypesBlockAst.cast,
        GenericBlockDeclarationAst.cast,
      ),
    ),
    offset,
  );
}

function blockBodyContainsOffset(block: BracedBlock | undefined, offset: number): boolean {
  if (block === undefined) {
    return false;
  }
  const lbrace = block.lbrace();
  if (lbrace === undefined) {
    return false;
  }
  const bodyStart = lbrace.endOffset;
  const bodyEnd = block.rbrace()?.offset ?? block.syntax.endOffset;
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

  if (hasUnsupportedAncestor(input.node)) {
    return unsupported(input.offset);
  }

  if (!blockBodyContainsOffset(block, input.offset)) {
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
    closestAst(
      node,
      any(AttributeArgListAst.cast, FieldAttributeAst.cast, ModelAttributeAst.cast),
    ) !== undefined
  );
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
    if (result !== undefined) {
      return result;
    }
  }
  return undefined;
}

type CastTarget<C> = C extends (node: SyntaxNode) => infer R ? Exclude<R, undefined> : never;

function any<Casts extends readonly ((node: SyntaxNode) => unknown)[]>(
  ...casts: Casts
): (node: SyntaxNode) => CastTarget<Casts[number]> | undefined;
function any(
  ...casts: ReadonlyArray<(node: SyntaxNode) => unknown>
): (node: SyntaxNode) => unknown {
  return (node) => {
    for (const cast of casts) {
      const result = cast(node);
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  };
}

/** The nearest non-trivia token ending at or before the cursor. */
function previousSignificantToken(at: TokenAtOffset, offset: number): SyntaxToken | undefined {
  const left = at.leftBiased();
  if (left === undefined) {
    return undefined;
  }
  return left.endOffset <= offset && !isTrivia(left) ? left : previousNonTriviaToken(left);
}

/** The identifier token the cursor is editing, if any. */
function cursorIdentifier(at: TokenAtOffset, offset: number): SyntaxToken | undefined {
  const right = at.rightBiased();
  if (right?.kind === 'Ident' && offset < right.endOffset) {
    return right;
  }
  const left = at.leftBiased();
  if (left?.kind === 'Ident' && left.endOffset === offset) {
    return left;
  }
  return undefined;
}
