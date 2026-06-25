import {
  AttributeArgListAst,
  type DocumentAst,
  FieldAttributeAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  KeyValuePairAst,
  ModelAttributeAst,
  ModelDeclarationAst,
  type Position,
  type QualifiedNameAst,
  type SourceFile,
  type SyntaxNode,
  type SyntaxToken,
  TypeAnnotationAst,
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

export interface UnsupportedPslCompletionContext {
  readonly kind: 'unsupported';
  readonly offset: number;
  readonly reason: UnsupportedPslCompletionReason;
}

export type PslCompletionContext =
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
  if (
    closestAst(node, GenericBlockDeclarationAst.cast) !== undefined ||
    closestAst(node, KeyValuePairAst.cast) !== undefined
  ) {
    return 'genericBlock';
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
  if (end <= start) {
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
