import {
  AttributeArgListAst,
  CompositeTypeDeclarationAst,
  type DocumentAst,
  FieldAttributeAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  KeyValuePairAst,
  ModelAttributeAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
  type Position,
  type QualifiedNameAst,
  type SourceFile,
  type SyntaxNode,
  type SyntaxToken,
  TypeAnnotationAst,
  TypesBlockAst,
} from '@prisma-next/psl-parser/syntax';

export interface ClassifyPslCompletionContextInput {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly position: Position;
}

export type UnsupportedPslCompletionReason =
  | 'attribute'
  | 'attributeArgument'
  | 'comment'
  | 'constructorArgument'
  | 'fieldName'
  | 'genericBlock'
  | 'invalidQualifiedType'
  | 'notTypePrefix'
  | 'outsideModelField';

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
  readonly reason: UnsupportedPslCompletionReason;
}

export type PslCompletionContext =
  | DeclarationKeywordCompletionContext
  | GenericBlockParameterCompletionContext
  | ModelFieldTypeCompletionContext
  | UnsupportedPslCompletionContext;

interface TokenContext {
  readonly current?: SyntaxToken;
  readonly previous?: SyntaxToken;
  readonly previousSignificant?: SyntaxToken;
  readonly touching?: SyntaxToken;
}

export function classifyPslCompletionContext(
  input: ClassifyPslCompletionContextInput,
): PslCompletionContext {
  const offset = input.sourceFile.offsetAt(input.position);
  const tokenContext = findTokenContext(input.document.syntax, offset);
  if (tokenContext.current?.kind === 'Comment' || tokenContext.touching?.kind === 'Comment') {
    return unsupported(offset, 'comment');
  }

  const node = findDeepestNodeAtOffset(input.document.syntax, offset);
  const previousNode =
    tokenContext.previousSignificant === undefined
      ? undefined
      : findDeepestNodeAtOffset(input.document.syntax, tokenContext.previousSignificant.offset);
  const contextNode = nodeForContext(node, previousNode);
  const ancestorReason = unsupportedAncestorReason(contextNode);
  if (ancestorReason !== undefined) {
    return unsupported(offset, ancestorReason);
  }

  const declarationKeywordContext = classifyDeclarationKeyword({
    node: contextNode,
    offset,
    sourceFile: input.sourceFile,
    tokenContext,
  });
  if (declarationKeywordContext !== undefined) {
    return declarationKeywordContext;
  }

  const genericBlockContext = classifyGenericBlockParameter({
    node: contextNode,
    offset,
    sourceFile: input.sourceFile,
    tokenContext,
  });
  if (genericBlockContext !== undefined) {
    return genericBlockContext;
  }

  const field = closestAst(contextNode, FieldDeclarationAst.cast);
  if (field === undefined) {
    return unsupported(offset, 'outsideModelField');
  }
  if (closestAst(field.syntax, ModelDeclarationAst.cast) === undefined) {
    return unsupported(offset, 'outsideModelField');
  }

  return classifyModelFieldType({
    field,
    offset,
    sourceFile: input.sourceFile,
  });
}

function classifyModelFieldType(input: {
  readonly field: FieldDeclarationAst;
  readonly offset: number;
  readonly sourceFile: SourceFile;
}): PslCompletionContext {
  const fieldName = input.field.name();
  const fieldNameText = fieldName?.name();
  if (fieldName === undefined || fieldNameText === undefined) {
    return unsupported(input.offset, 'outsideModelField');
  }

  const fieldNameStart = fieldName.syntax.offset;
  const fieldNameEnd = endOffset(fieldName.syntax);
  if (input.offset >= fieldNameStart && input.offset <= fieldNameEnd) {
    return unsupported(input.offset, 'fieldName');
  }

  const typeAnnotation = input.field.typeAnnotation();
  if (typeAnnotation === undefined) {
    return unsupported(input.offset, 'outsideModelField');
  }

  const typeStart = typeAnnotation.syntax.offset;
  const typeEnd = endOffset(typeAnnotation.syntax);
  if (typeAnnotation.syntax.textLength === 0) {
    if (
      input.offset > fieldNameEnd &&
      input.offset <= typeStart &&
      hasOnlyHorizontalWhitespace(input.sourceFile.text, fieldNameEnd, input.offset)
    ) {
      return modelFieldType(input.offset, fieldNameText, { path: [], name: '' });
    }
    return unsupported(input.offset, 'notTypePrefix');
  }

  if (input.offset < typeStart || input.offset > typeEnd) {
    return unsupported(input.offset, 'notTypePrefix');
  }

  const constructorArgList = typeAnnotation.argList();
  if (constructorArgList !== undefined && containsOffset(constructorArgList.syntax, input.offset)) {
    return unsupported(input.offset, 'constructorArgument');
  }

  const name = typeAnnotation.name();
  if (name === undefined) {
    return unsupported(input.offset, 'notTypePrefix');
  }
  if (!containsOffset(name.syntax, input.offset)) {
    return unsupported(input.offset, 'notTypePrefix');
  }
  if (name.isOverQualified()) {
    return unsupported(input.offset, 'invalidQualifiedType');
  }

  const prefix = typeNamePrefix(name, input.offset, input.sourceFile.text);
  if (prefix === undefined) {
    return unsupported(input.offset, 'invalidQualifiedType');
  }

  return modelFieldType(input.offset, fieldNameText, prefix);
}

function modelFieldType(
  offset: number,
  fieldName: string,
  prefix: TypeNamePrefix,
): ModelFieldTypeCompletionContext {
  return { kind: 'modelFieldType', offset, fieldName, prefix };
}

function classifyDeclarationKeyword(input: {
  readonly node: SyntaxNode | undefined;
  readonly offset: number;
  readonly sourceFile: SourceFile;
  readonly tokenContext: TokenContext;
}): DeclarationKeywordCompletionContext | undefined {
  if (isInsideNonDeclarationKeywordBody(input.node, input.offset)) {
    return undefined;
  }

  const namespace = closestAst(input.node, NamespaceDeclarationAst.cast);
  const scope = namespaceBodyContainsOffset(namespace, input.offset) ? 'namespace' : 'document';
  const anchorOffset = scope === 'namespace' ? namespace?.lbrace()?.offset : undefined;
  const prefix = declarationKeywordPrefix({
    offset: input.offset,
    source: input.sourceFile.text,
    tokenContext: input.tokenContext,
    ...(anchorOffset === undefined ? {} : { anchorOffset }),
  });
  if (prefix === undefined) {
    return undefined;
  }

  return {
    kind: 'declarationKeyword',
    offset: input.offset,
    scope,
    prefix: prefix.text,
    replacementStartOffset: prefix.replacementStartOffset,
  };
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

function declarationKeywordPrefix(input: {
  readonly offset: number;
  readonly source: string;
  readonly tokenContext: TokenContext;
  readonly anchorOffset?: number;
}): { readonly text: string; readonly replacementStartOffset: number } | undefined {
  const token = declarationPrefixToken(input.tokenContext, input.offset);
  const start = token?.offset ?? input.offset;
  if (!hasOnlyHorizontalWhitespace(input.source, declarationPrefixAllowedStart(input), start)) {
    return undefined;
  }
  if (token === undefined) {
    return { text: '', replacementStartOffset: input.offset };
  }
  return {
    text: input.source.slice(token.offset, input.offset),
    replacementStartOffset: token.offset,
  };
}

function declarationPrefixToken(
  tokenContext: TokenContext,
  offset: number,
): SyntaxToken | undefined {
  if (tokenContext.current?.kind === 'Ident') {
    return tokenContext.current;
  }
  if (tokenContext.touching?.kind === 'Ident') {
    return tokenContext.touching;
  }
  if (
    tokenContext.previousSignificant?.kind === 'Ident' &&
    tokenContext.previousSignificant.offset + tokenContext.previousSignificant.text.length ===
      offset
  ) {
    return tokenContext.previousSignificant;
  }
  return undefined;
}

function declarationPrefixAllowedStart(input: {
  readonly offset: number;
  readonly source: string;
  readonly anchorOffset?: number;
}): number {
  const lineStart = lineStartOffset(input.source, input.offset);
  if (input.anchorOffset === undefined || input.anchorOffset < lineStart) {
    return lineStart;
  }
  return input.anchorOffset + 1;
}

function lineStartOffset(source: string, offset: number): number {
  const previousNewline = source.lastIndexOf('\n', Math.max(0, offset - 1));
  return previousNewline < 0 ? 0 : previousNewline + 1;
}

function classifyGenericBlockParameter(input: {
  readonly node: SyntaxNode | undefined;
  readonly offset: number;
  readonly sourceFile: SourceFile;
  readonly tokenContext: TokenContext;
}): PslCompletionContext | undefined {
  const block = closestAst(input.node, GenericBlockDeclarationAst.cast);
  if (block === undefined) {
    return undefined;
  }

  const lbrace = firstTokenOfKind(block.syntax, 'LBrace');
  if (lbrace === undefined || input.offset < lbrace.offset + lbrace.text.length) {
    return unsupported(input.offset, 'genericBlock');
  }

  const rbrace = firstTokenOfKind(block.syntax, 'RBrace');
  if (rbrace !== undefined && input.offset > rbrace.offset) {
    return unsupported(input.offset, 'genericBlock');
  }

  const field = closestAst(input.node, FieldDeclarationAst.cast);
  if (field !== undefined && containsOffset(field.syntax, input.offset)) {
    return unsupported(input.offset, 'genericBlock');
  }

  if (input.tokenContext.previousSignificant?.kind === 'Equals') {
    return unsupported(input.offset, 'genericBlock');
  }

  const keyword = block.keyword()?.text;
  if (keyword === undefined || keyword.length === 0) {
    return unsupported(input.offset, 'genericBlock');
  }

  const activePair = activeKeyValuePair(input.node, input.offset);
  if (activePair !== undefined && isAfterEquals(activePair, input.offset)) {
    return unsupported(input.offset, 'genericBlock');
  }

  const prefix = genericBlockParameterPrefix(activePair, input.offset, input.sourceFile.text);
  if (prefix === undefined) {
    return unsupported(input.offset, 'genericBlock');
  }

  return {
    kind: 'genericBlockParameter',
    offset: input.offset,
    blockKeyword: keyword,
    prefix: prefix.text,
    replacementStartOffset: prefix.replacementStartOffset,
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
  const equals = firstTokenOfKind(pair.syntax, 'Equals');
  return equals !== undefined && offset > equals.offset;
}

function genericBlockParameterPrefix(
  pair: KeyValuePairAst | undefined,
  offset: number,
  source: string,
): { readonly text: string; readonly replacementStartOffset: number } | undefined {
  if (pair === undefined) {
    return { text: '', replacementStartOffset: offset };
  }

  const key = pair.key();
  if (key === undefined) {
    return { text: '', replacementStartOffset: offset };
  }

  const keyStart = key.syntax.offset;
  const keyEnd = endOffset(key.syntax);
  if (offset < keyStart) {
    return { text: '', replacementStartOffset: offset };
  }
  if (offset <= keyEnd) {
    return { text: source.slice(keyStart, offset), replacementStartOffset: keyStart };
  }
  const equals = firstTokenOfKind(pair.syntax, 'Equals');
  if (equals === undefined || offset <= equals.offset) {
    return { text: source.slice(keyStart, keyEnd), replacementStartOffset: keyStart };
  }
  return undefined;
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

function firstTokenOfKind(node: SyntaxNode, kind: SyntaxToken['kind']): SyntaxToken | undefined {
  for (const token of node.tokens()) {
    if (token.kind === kind) {
      return token;
    }
  }
  return undefined;
}

function unsupported(
  offset: number,
  reason: UnsupportedPslCompletionReason,
): UnsupportedPslCompletionContext {
  return { kind: 'unsupported', offset, reason };
}

function unsupportedAncestorReason(
  node: SyntaxNode | undefined,
): UnsupportedPslCompletionReason | undefined {
  const argList = closestAst(node, AttributeArgListAst.cast);
  if (argList !== undefined) {
    return closestAst(argList.syntax, TypeAnnotationAst.cast) === undefined
      ? 'attributeArgument'
      : 'constructorArgument';
  }
  if (
    closestAst(node, FieldAttributeAst.cast) !== undefined ||
    closestAst(node, ModelAttributeAst.cast) !== undefined
  ) {
    return 'attribute';
  }
  return undefined;
}

function typeNamePrefix(
  name: QualifiedNameAst,
  offset: number,
  source: string,
): TypeNamePrefix | undefined {
  const end = Math.min(offset, endOffset(name.syntax));
  const raw = splitQualifiedPrefix(source.slice(name.syntax.offset, end));
  if (raw.colonCount > 1 || raw.dotCount > 1) {
    return undefined;
  }

  if (raw.colonCount === 0 && raw.dotCount === 0) {
    const nameSegment = segmentAt(raw.segments, 0);
    if (nameSegment === undefined) return undefined;
    return { path: pathFromSegments(raw.segments), name: nameSegment };
  }

  if (raw.colonCount === 0 && raw.dotCount === 1) {
    const namespace = segmentAt(raw.segments, 0);
    const nameSegment = segmentAt(raw.segments, 1);
    if (namespace === undefined || namespace.length === 0 || nameSegment === undefined) {
      return undefined;
    }
    return { path: pathFromSegments(raw.segments), namespace, name: nameSegment };
  }

  if (raw.colonCount === 1 && raw.dotCount === 0) {
    const contractSpace = segmentAt(raw.segments, 0);
    const nameSegment = segmentAt(raw.segments, 1);
    if (contractSpace === undefined || contractSpace.length === 0 || nameSegment === undefined) {
      return undefined;
    }
    return { path: pathFromSegments(raw.segments), contractSpace, name: nameSegment };
  }

  const contractSpace = segmentAt(raw.segments, 0);
  const namespace = segmentAt(raw.segments, 1);
  const nameSegment = segmentAt(raw.segments, 2);
  if (
    contractSpace === undefined ||
    contractSpace.length === 0 ||
    namespace === undefined ||
    namespace.length === 0 ||
    nameSegment === undefined
  ) {
    return undefined;
  }
  return {
    path: pathFromSegments(raw.segments),
    contractSpace,
    namespace,
    name: nameSegment,
  };
}

function splitQualifiedPrefix(text: string): {
  readonly segments: readonly string[];
  readonly colonCount: number;
  readonly dotCount: number;
} {
  const segments = [''];
  let colonCount = 0;
  let dotCount = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (char === ':') {
      colonCount++;
      segments.push('');
      continue;
    }
    if (char === '.') {
      dotCount++;
      segments.push('');
      continue;
    }
    const lastIndex = segments.length - 1;
    segments[lastIndex] = `${segments[lastIndex] ?? ''}${char}`;
  }
  return { segments, colonCount, dotCount };
}

function pathFromSegments(segments: readonly string[]): readonly string[] {
  return segments.filter((segment) => segment.length > 0);
}

function segmentAt(segments: readonly string[], index: number): string | undefined {
  return segments[index];
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
  for (let current = node; current !== undefined; current = current.parent) {
    const result = cast(current);
    if (result !== undefined) return result;
  }
  return undefined;
}

function findDeepestNodeAtOffset(node: SyntaxNode, offset: number): SyntaxNode | undefined {
  if (!containsOffset(node, offset)) {
    return undefined;
  }
  let deepest = node;
  for (const child of node.childNodes()) {
    const childMatch = findDeepestNodeAtOffset(child, offset);
    if (childMatch !== undefined) {
      deepest = childMatch;
    }
  }
  return deepest;
}

function findTokenContext(root: SyntaxNode, offset: number): TokenContext {
  let current: SyntaxToken | undefined;
  let previous: SyntaxToken | undefined;
  let previousSignificant: SyntaxToken | undefined;
  let touching: SyntaxToken | undefined;

  for (const token of root.tokens()) {
    const tokenEnd = token.offset + token.text.length;
    if (offset >= token.offset && offset < tokenEnd) {
      current = token;
    }
    if (offset > token.offset && offset <= tokenEnd) {
      touching = token;
    }
    if (tokenEnd <= offset) {
      previous = token;
      if (!isTrivia(token)) {
        previousSignificant = token;
      }
      continue;
    }
    if (token.offset > offset) {
      break;
    }
  }

  return tokenContext({ current, previous, previousSignificant, touching });
}

function tokenContext(input: {
  readonly current: SyntaxToken | undefined;
  readonly previous: SyntaxToken | undefined;
  readonly previousSignificant: SyntaxToken | undefined;
  readonly touching: SyntaxToken | undefined;
}): TokenContext {
  return {
    ...(input.current === undefined ? {} : { current: input.current }),
    ...(input.previous === undefined ? {} : { previous: input.previous }),
    ...(input.previousSignificant === undefined
      ? {}
      : { previousSignificant: input.previousSignificant }),
    ...(input.touching === undefined ? {} : { touching: input.touching }),
  };
}

function isTrivia(token: SyntaxToken): boolean {
  return token.kind === 'Whitespace' || token.kind === 'Newline' || token.kind === 'Comment';
}

function containsOffset(node: SyntaxNode, offset: number): boolean {
  const start = node.offset;
  const end = endOffset(node);
  return node.textLength === 0 ? offset === start : offset >= start && offset <= end;
}

function endOffset(node: SyntaxNode): number {
  return node.offset + node.textLength;
}

function hasOnlyHorizontalWhitespace(source: string, start: number, end: number): boolean {
  if (end < start) {
    return false;
  }
  for (let index = start; index < end; index++) {
    const char = source.charAt(index);
    if (char !== ' ' && char !== '\t') {
      return false;
    }
  }
  return true;
}
