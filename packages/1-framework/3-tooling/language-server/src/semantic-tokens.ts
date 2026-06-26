import type { SymbolTable } from '@prisma-next/psl-parser';
import {
  ArrayLiteralAst,
  type AttributeArgAst,
  type AttributeArgListAst,
  BooleanLiteralExprAst,
  CompositeTypeDeclarationAst,
  type DocumentAst,
  type ExpressionAst,
  type FieldAttributeAst,
  type FieldDeclarationAst,
  FunctionCallAst,
  filterChildren,
  type GenericBlockDeclarationAst,
  IdentifierAst,
  type ModelAttributeAst,
  ModelDeclarationAst,
  type NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
  NumberLiteralExprAst,
  ObjectLiteralExprAst,
  type QualifiedNameAst,
  type SourceFile,
  StringLiteralExprAst,
  type SyntaxToken,
  type TypeAnnotationAst,
  TypesBlockAst,
} from '@prisma-next/psl-parser/syntax';
import type { Range, SemanticTokens, SemanticTokensLegend } from 'vscode-languageserver';

export const semanticTokenTypes = [
  'keyword',
  'namespace',
  'class',
  'struct',
  'type',
  'property',
  'decorator',
  'string',
  'number',
  'comment',
] as const;

export const semanticTokenModifiers = ['declaration', 'defaultLibrary'] as const;

export type SemanticTokenType = (typeof semanticTokenTypes)[number];
export type SemanticTokenModifier = (typeof semanticTokenModifiers)[number];

export const semanticTokensLegend: SemanticTokensLegend = {
  tokenTypes: [...semanticTokenTypes],
  tokenModifiers: [...semanticTokenModifiers],
};

export interface SemanticTokenSource {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly symbolTable: SymbolTable | undefined;
  readonly scalarTypes: readonly string[];
}

export interface SemanticTokenRange {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly tokenType: SemanticTokenType;
  readonly modifiers?: readonly SemanticTokenModifier[];
}

type DeclarationAst =
  | ModelDeclarationAst
  | CompositeTypeDeclarationAst
  | NamespaceDeclarationAst
  | TypesBlockAst
  | GenericBlockDeclarationAst;

type AttributeAst = FieldAttributeAst | ModelAttributeAst;

type TypeReferenceKind = 'class' | 'struct' | 'type';

interface TypeReferenceClassification {
  readonly tokenType: TypeReferenceKind;
  readonly modifiers?: readonly SemanticTokenModifier[];
}

interface IdentifierSegment {
  readonly identifier: IdentifierAst;
  readonly text: string;
}

export function collectSemanticTokens(source: SemanticTokenSource): readonly SemanticTokenRange[] {
  const tokens: SemanticTokenRange[] = [];
  collectLexicalTokens(source.document, tokens);
  collectDeclarations(source, tokens);
  return resolveSemanticTokenRanges(tokens);
}

export function collectSemanticTokensInRange(
  source: SemanticTokenSource,
  range: Range,
): readonly SemanticTokenRange[] {
  const startOffset = source.sourceFile.offsetAt(range.start);
  const endOffset = source.sourceFile.offsetAt(range.end);
  const lower = Math.min(startOffset, endOffset);
  const upper = Math.max(startOffset, endOffset);
  return collectSemanticTokens(source).filter(
    (token) => token.startOffset < upper && token.endOffset > lower,
  );
}

export function encodeSemanticTokens(
  sourceFile: SourceFile,
  tokens: readonly SemanticTokenRange[],
): SemanticTokens {
  const normalized = normalizeSemanticTokenRanges(sourceFile, tokens);
  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  let first = true;

  for (const token of normalized) {
    const start = sourceFile.positionAt(token.startOffset);
    const length = token.endOffset - token.startOffset;
    const deltaLine = first ? start.line : start.line - previousLine;
    const deltaStart =
      first || deltaLine !== 0 ? start.character : start.character - previousCharacter;
    data.push(
      deltaLine,
      deltaStart,
      length,
      semanticTokenTypes.indexOf(token.tokenType),
      modifierBitset(token.modifiers),
    );
    previousLine = start.line;
    previousCharacter = start.character;
    first = false;
  }

  return { data };
}

function collectLexicalTokens(document: DocumentAst, tokens: SemanticTokenRange[]): void {
  for (const token of document.syntax.tokens()) {
    switch (token.kind) {
      case 'Comment':
        tokens.push(rangeForToken(token, 'comment'));
        break;
      case 'StringLiteral':
        tokens.push(rangeForToken(token, 'string'));
        break;
      case 'NumberLiteral':
        tokens.push(rangeForToken(token, 'number'));
        break;
      default:
        break;
    }
  }
}

function collectDeclarations(source: SemanticTokenSource, tokens: SemanticTokenRange[]): void {
  for (const declaration of source.document.declarations()) {
    collectDeclaration(declaration, source, tokens, undefined);
  }
}

function collectDeclaration(
  declaration: DeclarationAst,
  source: SemanticTokenSource,
  tokens: SemanticTokenRange[],
  namespace: string | undefined,
): void {
  if (declaration instanceof ModelDeclarationAst) {
    addToken(declaration.keyword(), 'keyword', tokens);
    addIdentifier(declaration.name(), 'class', tokens, ['declaration']);
    collectFields(declaration.fields(), source, tokens, namespace);
    collectAttributes(declaration.attributes(), source, tokens, namespace);
    return;
  }

  if (declaration instanceof CompositeTypeDeclarationAst) {
    addToken(declaration.keyword(), 'keyword', tokens);
    addIdentifier(declaration.name(), 'struct', tokens, ['declaration']);
    collectFields(declaration.fields(), source, tokens, namespace);
    collectAttributes(declaration.attributes(), source, tokens, namespace);
    return;
  }

  if (declaration instanceof NamespaceDeclarationAst) {
    addToken(declaration.keyword(), 'keyword', tokens);
    addIdentifier(declaration.name(), 'namespace', tokens, ['declaration']);
    const nestedNamespace = declaration.name()?.name();
    for (const nested of declaration.declarations()) {
      collectDeclaration(nested, source, tokens, nestedNamespace);
    }
    return;
  }

  if (declaration instanceof TypesBlockAst) {
    addToken(declaration.keyword(), 'keyword', tokens);
    for (const namedType of declaration.declarations()) {
      collectNamedTypeDeclaration(namedType, source, tokens, namespace);
    }
    return;
  }

  addToken(declaration.keyword(), 'keyword', tokens);
  addIdentifier(declaration.name(), 'type', tokens, ['declaration']);
  for (const entry of declaration.entries()) {
    addIdentifier(entry.key(), 'property', tokens);
    collectExpression(entry.value(), source, tokens, namespace);
  }
  collectAttributes(declaration.attributes(), source, tokens, namespace);
}

function collectNamedTypeDeclaration(
  declaration: NamedTypeDeclarationAst,
  source: SemanticTokenSource,
  tokens: SemanticTokenRange[],
  namespace: string | undefined,
): void {
  addIdentifier(declaration.name(), 'type', tokens, ['declaration']);
  collectTypeAnnotation(declaration.typeAnnotation(), source, tokens, namespace);
  collectAttributes(declaration.attributes(), source, tokens, namespace);
}

function collectFields(
  fields: Iterable<FieldDeclarationAst>,
  source: SemanticTokenSource,
  tokens: SemanticTokenRange[],
  namespace: string | undefined,
): void {
  for (const field of fields) {
    addIdentifier(field.name(), 'property', tokens, ['declaration']);
    collectTypeAnnotation(field.typeAnnotation(), source, tokens, namespace);
    collectAttributes(field.attributes(), source, tokens, namespace);
  }
}

function collectTypeAnnotation(
  annotation: TypeAnnotationAst | undefined,
  source: SemanticTokenSource,
  tokens: SemanticTokenRange[],
  namespace: string | undefined,
): void {
  if (annotation === undefined) {
    return;
  }
  collectTypeReference(annotation.name(), source, tokens, namespace);
  collectAttributeArgList(annotation.argList(), source, tokens, namespace);
}

function collectAttributes(
  attributes: Iterable<AttributeAst>,
  source: SemanticTokenSource,
  tokens: SemanticTokenRange[],
  namespace: string | undefined,
): void {
  for (const attribute of attributes) {
    collectDecoratorName(attribute.name(), tokens);
    collectAttributeArgList(attribute.argList(), source, tokens, namespace);
  }
}

function collectDecoratorName(
  name: QualifiedNameAst | undefined,
  tokens: SemanticTokenRange[],
): void {
  if (name === undefined) {
    return;
  }
  for (const segment of identifierSegments(name)) {
    tokens.push(rangeForIdentifier(segment.identifier, 'decorator'));
  }
}

function collectAttributeArgList(
  argList: AttributeArgListAst | undefined,
  source: SemanticTokenSource,
  tokens: SemanticTokenRange[],
  namespace: string | undefined,
): void {
  if (argList === undefined) {
    return;
  }
  for (const arg of argList.args()) {
    collectAttributeArg(arg, source, tokens, namespace);
  }
}

function collectAttributeArg(
  arg: AttributeArgAst,
  source: SemanticTokenSource,
  tokens: SemanticTokenRange[],
  namespace: string | undefined,
): void {
  addIdentifier(arg.name(), 'property', tokens);
  collectExpression(arg.value(), source, tokens, namespace);
}

function collectExpression(
  expression: ExpressionAst | undefined,
  source: SemanticTokenSource,
  tokens: SemanticTokenRange[],
  namespace: string | undefined,
): void {
  if (expression === undefined) {
    return;
  }

  if (expression instanceof StringLiteralExprAst) {
    addToken(expression.token(), 'string', tokens);
    return;
  }

  if (expression instanceof NumberLiteralExprAst) {
    addToken(expression.token(), 'number', tokens);
    return;
  }

  if (expression instanceof BooleanLiteralExprAst) {
    addToken(expression.token(), 'keyword', tokens);
    return;
  }

  if (expression instanceof FunctionCallAst) {
    collectTypeReference(expression.name(), source, tokens, namespace);
    for (const arg of expression.args()) {
      collectAttributeArg(arg, source, tokens, namespace);
    }
    return;
  }

  if (expression instanceof ArrayLiteralAst) {
    for (const element of expression.elements()) {
      collectExpression(element, source, tokens, namespace);
    }
    return;
  }

  if (expression instanceof ObjectLiteralExprAst) {
    for (const field of expression.fields()) {
      addIdentifier(field.key(), 'property', tokens);
      collectExpression(field.value(), source, tokens, namespace);
    }
    return;
  }

  collectIdentifierExpression(expression, source, tokens, namespace);
}

function collectIdentifierExpression(
  identifier: IdentifierAst,
  source: SemanticTokenSource,
  tokens: SemanticTokenRange[],
  namespace: string | undefined,
): void {
  const text = identifier.name();
  if (text === undefined) {
    return;
  }
  const classification = classifyTypeReference([text], source, namespace);
  tokens.push(rangeForIdentifier(identifier, classification.tokenType, classification.modifiers));
}

function collectTypeReference(
  name: QualifiedNameAst | undefined,
  source: SemanticTokenSource,
  tokens: SemanticTokenRange[],
  namespace: string | undefined,
): void {
  if (name === undefined) {
    return;
  }

  const segments = identifierSegments(name);
  if (segments.length === 0) {
    return;
  }

  const path = segments.map((segment) => segment.text);
  for (const segment of segments.slice(0, -1)) {
    if (isKnownNamespace(segment.text, source.symbolTable)) {
      tokens.push(rangeForIdentifier(segment.identifier, 'namespace'));
    }
  }

  const finalSegment = segments[segments.length - 1];
  if (finalSegment === undefined) {
    return;
  }
  const classification = classifyTypeReference(path, source, namespace);
  tokens.push(
    rangeForIdentifier(finalSegment.identifier, classification.tokenType, classification.modifiers),
  );
}

function classifyTypeReference(
  path: readonly string[],
  source: SemanticTokenSource,
  namespace: string | undefined,
): TypeReferenceClassification {
  const name = path[path.length - 1];
  if (name === undefined) {
    return { tokenType: 'type' };
  }

  const table = source.symbolTable;
  const namespaceName = path.length > 1 ? path[path.length - 2] : namespace;
  const namespaceScope =
    namespaceName !== undefined ? table?.topLevel.namespaces[namespaceName] : undefined;

  if (namespaceScope !== undefined) {
    if (Object.hasOwn(namespaceScope.models, name)) {
      return { tokenType: 'class' };
    }
    if (Object.hasOwn(namespaceScope.compositeTypes, name)) {
      return { tokenType: 'struct' };
    }
    if (Object.hasOwn(namespaceScope.blocks, name)) {
      return { tokenType: 'type' };
    }
  }

  if (table !== undefined) {
    if (Object.hasOwn(table.topLevel.models, name)) {
      return { tokenType: 'class' };
    }
    if (Object.hasOwn(table.topLevel.compositeTypes, name)) {
      return { tokenType: 'struct' };
    }
    if (Object.hasOwn(table.topLevel.scalars, name)) {
      return { tokenType: 'type', modifiers: ['defaultLibrary'] };
    }
    if (
      Object.hasOwn(table.topLevel.typeAliases, name) ||
      Object.hasOwn(table.topLevel.blocks, name)
    ) {
      return { tokenType: 'type' };
    }
  }

  if (source.scalarTypes.includes(name)) {
    return { tokenType: 'type', modifiers: ['defaultLibrary'] };
  }

  return { tokenType: 'type' };
}

function isKnownNamespace(name: string, table: SymbolTable | undefined): boolean {
  return table !== undefined && Object.hasOwn(table.topLevel.namespaces, name);
}

function identifierSegments(name: QualifiedNameAst): readonly IdentifierSegment[] {
  const segments: IdentifierSegment[] = [];
  for (const identifier of filterChildren(name.syntax, IdentifierAst.cast)) {
    const text = identifier.name();
    if (text !== undefined) {
      segments.push({ identifier, text });
    }
  }
  return segments;
}

function addIdentifier(
  identifier: IdentifierAst | undefined,
  tokenType: SemanticTokenType,
  tokens: SemanticTokenRange[],
  modifiers?: readonly SemanticTokenModifier[],
): void {
  if (identifier === undefined) {
    return;
  }
  tokens.push(rangeForIdentifier(identifier, tokenType, modifiers));
}

function addToken(
  token: SyntaxToken | undefined,
  tokenType: SemanticTokenType,
  tokens: SemanticTokenRange[],
  modifiers?: readonly SemanticTokenModifier[],
): void {
  if (token === undefined) {
    return;
  }
  tokens.push(rangeForToken(token, tokenType, modifiers));
}

function rangeForIdentifier(
  identifier: IdentifierAst,
  tokenType: SemanticTokenType,
  modifiers?: readonly SemanticTokenModifier[],
): SemanticTokenRange {
  const token = identifier.token();
  if (token === undefined) {
    return {
      startOffset: identifier.syntax.offset,
      endOffset: identifier.syntax.offset,
      tokenType,
    };
  }
  return rangeForToken(token, tokenType, modifiers);
}

function rangeForToken(
  token: SyntaxToken,
  tokenType: SemanticTokenType,
  modifiers?: readonly SemanticTokenModifier[],
): SemanticTokenRange {
  const range = {
    startOffset: token.offset,
    endOffset: token.offset + token.text.length,
    tokenType,
  };
  return modifiers === undefined || modifiers.length === 0 ? range : { ...range, modifiers };
}

function normalizeSemanticTokenRanges(
  sourceFile: SourceFile,
  tokens: readonly SemanticTokenRange[],
): readonly SemanticTokenRange[] {
  const split: SemanticTokenRange[] = [];
  for (const token of resolveSemanticTokenRanges(tokens)) {
    const startOffset = clamp(token.startOffset, 0, sourceFile.length);
    const endOffset = clamp(token.endOffset, 0, sourceFile.length);
    if (endOffset <= startOffset) {
      continue;
    }
    splitTokenRange(sourceFile, { ...token, startOffset, endOffset }, split);
  }
  return resolveSemanticTokenRanges(split);
}

function splitTokenRange(
  sourceFile: SourceFile,
  token: SemanticTokenRange,
  result: SemanticTokenRange[],
): void {
  const start = sourceFile.positionAt(token.startOffset);
  const end = sourceFile.positionAt(token.endOffset);
  for (let line = start.line; line <= end.line; line++) {
    const startOffset = line === start.line ? token.startOffset : lineStartOffset(sourceFile, line);
    const endOffset = line === end.line ? token.endOffset : lineEndOffset(sourceFile, line);
    if (endOffset > startOffset) {
      result.push({ ...token, startOffset, endOffset });
    }
  }
}

function lineStartOffset(sourceFile: SourceFile, line: number): number {
  return sourceFile.lineStartOffsets()[line] ?? sourceFile.length;
}

function lineEndOffset(sourceFile: SourceFile, line: number): number {
  const nextLineStart = sourceFile.lineStartOffsets()[line + 1];
  if (nextLineStart === undefined) {
    return sourceFile.length;
  }

  let end = nextLineStart;
  while (end > 0) {
    const character = sourceFile.text.charAt(end - 1);
    if (character !== '\n' && character !== '\r') {
      break;
    }
    end--;
  }
  return end;
}

function resolveSemanticTokenRanges(
  tokens: readonly SemanticTokenRange[],
): readonly SemanticTokenRange[] {
  const byRange = new Map<string, SemanticTokenRange>();
  for (const token of tokens) {
    const key = `${token.startOffset}:${token.endOffset}`;
    const existing = byRange.get(key);
    byRange.set(key, existing === undefined ? token : mergeDuplicateToken(existing, token));
  }
  return [...byRange.values()].sort(compareSemanticTokenRanges);
}

function mergeDuplicateToken(
  existing: SemanticTokenRange,
  next: SemanticTokenRange,
): SemanticTokenRange {
  if (existing.tokenType !== next.tokenType) {
    return next;
  }

  const modifiers = mergeModifiers(existing.modifiers, next.modifiers);
  return modifiers.length === 0 ? existing : { ...existing, modifiers };
}

function mergeModifiers(
  left: readonly SemanticTokenModifier[] | undefined,
  right: readonly SemanticTokenModifier[] | undefined,
): readonly SemanticTokenModifier[] {
  const result: SemanticTokenModifier[] = [];
  for (const modifier of semanticTokenModifiers) {
    if (left?.includes(modifier) || right?.includes(modifier)) {
      result.push(modifier);
    }
  }
  return result;
}

function compareSemanticTokenRanges(left: SemanticTokenRange, right: SemanticTokenRange): number {
  return (
    left.startOffset - right.startOffset ||
    left.endOffset - right.endOffset ||
    semanticTokenTypes.indexOf(left.tokenType) - semanticTokenTypes.indexOf(right.tokenType) ||
    modifierBitset(left.modifiers) - modifierBitset(right.modifiers)
  );
}

function modifierBitset(modifiers: readonly SemanticTokenModifier[] | undefined): number {
  let bitset = 0;
  if (modifiers === undefined) {
    return bitset;
  }
  for (const modifier of modifiers) {
    const index = semanticTokenModifiers.indexOf(modifier);
    if (index >= 0) {
      bitset |= 1 << index;
    }
  }
  return bitset;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
