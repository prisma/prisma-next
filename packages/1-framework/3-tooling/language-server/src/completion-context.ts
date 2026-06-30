import {
  AttributeArgListAst,
  any,
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
  nonTriviaSibling,
  type Position,
  previousNonTriviaToken,
  type QualifiedNameAst,
  type SourceFile,
  type SyntaxNode,
  type SyntaxToken,
  skipTriviaToken,
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
}

export type PslCompletionContext =
  | DeclarationKeywordCompletionContext
  | GenericBlockKeyCompletionContext
  | GenericBlockValueCompletionContext
  | ModelTypeCompletionContext
  | NamespaceMemberCompletionContext
  | SpaceMemberCompletionContext
  | UnsupportedPslCompletionContext;

const UNSUPPORTED: UnsupportedPslCompletionContext = { kind: 'unsupported' };

export function classifyPslCompletionContext(
  input: ClassifyPslCompletionContextInput,
): PslCompletionContext {
  const root = input.document.syntax;
  const offset = input.sourceFile.offsetAt(input.position);
  const at = root.tokenAtOffset(offset);

  // Completion is never offered when the cursor sits inside a comment.
  if (at.leftBiased()?.kind === 'Comment') {
    return UNSUPPORTED;
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

  const field = fieldForTypeSlot(contextNode, at);
  if (field === undefined) {
    return UNSUPPORTED;
  }
  if (
    field.syntax.findAncestor(any(ModelDeclarationAst.cast, CompositeTypeDeclarationAst.cast)) ===
    undefined
  ) {
    return UNSUPPORTED;
  }

  return classifyModelFieldType({
    field,
    offset,
    replacementStartOffset,
  });
}

/**
 * Locates the field whose type position the cursor occupies. A present type or
 * attribute keeps the cursor anchored inside the field, so the node ancestry
 * resolves it directly. A typeless field emits no `TypeAnnotation`, so its
 * trailing trivia belongs to the enclosing block instead; there the field is
 * the owner of the nearest significant token to the left.
 */
function fieldForTypeSlot(
  contextNode: SyntaxNode | undefined,
  at: TokenAtOffset,
): FieldDeclarationAst | undefined {
  const direct = contextNode?.findAncestor(FieldDeclarationAst.cast);
  if (direct !== undefined) {
    return direct;
  }
  const left = at.leftBiased();
  if (left === undefined) {
    return undefined;
  }
  const significant = isTrivia(left) ? skipTriviaToken(left, 'prev') : left;
  return significant?.parent.findAncestor(FieldDeclarationAst.cast);
}

/**
 * The upper bound of a typeless field's empty type slot: the first attribute
 * when present, otherwise the next significant token after the field (the
 * following member or the block's closing brace), since a typeless field's
 * trailing trivia lives in the enclosing block.
 */
function emptyTypeSlotEnd(field: FieldDeclarationAst): number {
  for (const attribute of field.attributes()) {
    return attribute.syntax.offset;
  }
  const nextSignificant = nonTriviaSibling(field.syntax, 'next');
  return nextSignificant?.offset ?? field.syntax.endOffset;
}

function classifyModelFieldType(input: {
  readonly field: FieldDeclarationAst;
  readonly offset: number;
  readonly replacementStartOffset: number;
}): PslCompletionContext {
  const fieldName = input.field.name();
  if (fieldName === undefined) {
    return UNSUPPORTED;
  }
  const fieldNameText = fieldName.name();
  if (fieldNameText === undefined) {
    return UNSUPPORTED;
  }

  const fieldNameEnd = fieldName.syntax.endOffset;

  if (fieldName.syntax.isInside(input.offset)) {
    return UNSUPPORTED;
  }

  const typeAnnotation = input.field.typeAnnotation();
  if (typeAnnotation === undefined) {
    const slotEnd = emptyTypeSlotEnd(input.field);
    if (input.offset > fieldNameEnd && input.offset <= slotEnd) {
      return {
        kind: 'modelType',
        offset: input.offset,
        fieldName: fieldNameText,
        replacementStartOffset: input.offset,
      };
    }
    return UNSUPPORTED;
  }

  if (typeAnnotation.syntax.isOutside(input.offset)) {
    return UNSUPPORTED;
  }

  const constructorArgList = typeAnnotation.argList();
  if (constructorArgList?.syntax.isInside(input.offset)) {
    return UNSUPPORTED;
  }

  const name = typeAnnotation.name();
  if (name === undefined) {
    return UNSUPPORTED;
  }
  if (name.syntax.isOutside(input.offset)) {
    return UNSUPPORTED;
  }
  if (name.isOverQualified()) {
    return UNSUPPORTED;
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

const declarationCast = any(
  ModelDeclarationAst.cast,
  CompositeTypeDeclarationAst.cast,
  TypesBlockAst.cast,
  GenericBlockDeclarationAst.cast,
  NamespaceDeclarationAst.cast,
);

type DeclarationAst = NonNullable<ReturnType<typeof declarationCast>>;

function classifyDeclarationKeyword(input: {
  readonly node: SyntaxNode | undefined;
  readonly offset: number;
  readonly replacementStartOffset: number;
}): DeclarationKeywordCompletionContext | undefined {
  const declaration = input.node?.findAncestor(declarationCast);
  const namespace = input.node?.findAncestor(NamespaceDeclarationAst.cast);
  const inNamespaceBody = blockBodyContainsOffset(namespace, input.offset);

  if (
    declaration !== undefined &&
    !canBeginDeclaration(declaration, input.offset, inNamespaceBody)
  ) {
    return undefined;
  }

  return {
    kind: 'declarationKeyword',
    offset: input.offset,
    scope: inNamespaceBody ? 'namespace' : 'document',
    replacementStartOffset: input.replacementStartOffset,
  };
}

/**
 * Whether a new declaration can begin at the cursor, given the nearest enclosing
 * declaration. Allowed when that declaration is still nascent (only its keyword
 * typed, no name or body yet), when it is a namespace whose body holds further
 * declarations, or when the cursor sits past its closing `}`.
 */
function canBeginDeclaration(
  declaration: DeclarationAst,
  offset: number,
  inNamespaceBody: boolean,
): boolean {
  const keywordOnly =
    declaration.lbrace() === undefined &&
    (declaration instanceof TypesBlockAst || declaration.name() === undefined);
  if (keywordOnly) {
    return true;
  }
  if (declaration instanceof NamespaceDeclarationAst) {
    return inNamespaceBody;
  }
  const rbrace = declaration.rbrace();
  return rbrace !== undefined && offset >= rbrace.endOffset;
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
  const block = input.node?.findAncestor(GenericBlockDeclarationAst.cast);
  if (block === undefined) {
    return undefined;
  }

  if (hasUnsupportedAncestor(input.node)) {
    return UNSUPPORTED;
  }

  if (!blockBodyContainsOffset(block, input.offset)) {
    return UNSUPPORTED;
  }

  const field = input.node?.findAncestor(FieldDeclarationAst.cast);
  if (field?.syntax.isInside(input.offset)) {
    return UNSUPPORTED;
  }

  const keyword = block.keyword()?.text;
  if (keyword === undefined || keyword.length === 0) {
    return UNSUPPORTED;
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
    return UNSUPPORTED;
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
  const pair = node?.findAncestor(KeyValuePairAst.cast);
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

function hasUnsupportedAncestor(node: SyntaxNode | undefined): boolean {
  return (
    node?.findAncestor(
      any(AttributeArgListAst.cast, FieldAttributeAst.cast, ModelAttributeAst.cast),
    ) !== undefined
  );
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
