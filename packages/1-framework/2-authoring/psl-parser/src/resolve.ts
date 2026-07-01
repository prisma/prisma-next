import type { PslSpan } from '@prisma-next/framework-components/psl-ast';
import type { Position, Range, SourceFile } from './source-file';
import type {
  AttributeArgListAst,
  FieldAttributeAst,
  ModelAttributeAst,
} from './syntax/ast/attributes';
import {
  ArrayLiteralAst,
  BooleanLiteralExprAst,
  type ExpressionAst,
  FunctionCallAst,
  NumberLiteralExprAst,
  ObjectLiteralExprAst,
  StringLiteralExprAst,
} from './syntax/ast/expressions';
import { IdentifierAst } from './syntax/ast/identifier';
import type { QualifiedNameAst } from './syntax/ast/qualified-name';
import type { TypeAnnotationAst } from './syntax/ast/type-annotation';
import { printSyntax } from './syntax/ast-helpers';
import type { SyntaxNode } from './syntax/red';

/**
 * A structurally decoded attribute-argument expression. Consumers that need the
 * shape of an expression (e.g. array-literal `@default([...])`) read this instead
 * of re-parsing the stringified {@link ResolvedAttributeArg.value}.
 */
export type ResolvedExpr =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'array'; readonly elements: readonly ResolvedExpr[] }
  | { readonly kind: 'object' }
  | { readonly kind: 'call'; readonly path: readonly string[] }
  | { readonly kind: 'identifier'; readonly name: string };

export interface ResolvedAttributeArg {
  readonly kind: 'positional' | 'named';
  readonly name?: string;
  readonly value: string;
  readonly expression?: ResolvedExpr;
  readonly span: PslSpan;
}

export interface ResolvedAttribute {
  readonly name: string;
  readonly args: readonly ResolvedAttributeArg[];
  readonly span: PslSpan;
}

export interface ResolvedTypeConstructorCall {
  readonly path: readonly string[];
  readonly args: readonly ResolvedAttributeArg[];
  readonly span: PslSpan;
}

export function readResolvedAttribute(
  attribute: FieldAttributeAst | ModelAttributeAst,
  sourceFile: SourceFile,
): ResolvedAttribute {
  return {
    name: attributeName(attribute.name()),
    args: readResolvedArgList(attribute.argList(), sourceFile),
    span: nodePslSpan(attribute.syntax, sourceFile),
  };
}

export function readResolvedAttributes(
  attributes: Iterable<FieldAttributeAst | ModelAttributeAst>,
  sourceFile: SourceFile,
): readonly ResolvedAttribute[] {
  return Array.from(attributes, (attribute) => readResolvedAttribute(attribute, sourceFile));
}

export function readResolvedConstructorCall(
  annotation: TypeAnnotationAst | undefined,
  sourceFile: SourceFile,
): ResolvedTypeConstructorCall | undefined {
  const argList = annotation?.argList();
  if (annotation === undefined || argList === undefined) return undefined;
  return {
    path: annotation.name()?.path() ?? [],
    args: readResolvedArgList(argList, sourceFile),
    span: nodePslSpan(annotation.syntax, sourceFile),
  };
}

function readResolvedArgList(
  argList: AttributeArgListAst | undefined,
  sourceFile: SourceFile,
): readonly ResolvedAttributeArg[] {
  if (argList === undefined) return [];
  const args: ResolvedAttributeArg[] = [];
  for (const arg of argList.args()) {
    const name = arg.name()?.name();
    const value = arg.value();
    const expression = decodeExpression(value);
    args.push({
      kind: name !== undefined ? 'named' : 'positional',
      ...(name !== undefined ? { name } : {}),
      value: renderExpression(value),
      ...(expression !== undefined ? { expression } : {}),
      span: nodePslSpan(arg.syntax, sourceFile),
    });
  }
  return args;
}

function decodeExpression(expression: ExpressionAst | undefined): ResolvedExpr | undefined {
  if (expression === undefined) return undefined;
  if (expression instanceof StringLiteralExprAst) {
    const value = expression.value();
    return value === undefined ? undefined : { kind: 'string', value };
  }
  if (expression instanceof NumberLiteralExprAst) {
    const value = expression.value();
    return value === undefined ? undefined : { kind: 'number', value };
  }
  if (expression instanceof BooleanLiteralExprAst) {
    const value = expression.value();
    return value === undefined ? undefined : { kind: 'boolean', value };
  }
  if (expression instanceof ArrayLiteralAst) {
    const elements: ResolvedExpr[] = [];
    for (const element of expression.elements()) {
      const decoded = decodeExpression(element);
      if (decoded === undefined) return undefined;
      elements.push(decoded);
    }
    return { kind: 'array', elements };
  }
  if (expression instanceof FunctionCallAst) {
    return { kind: 'call', path: expression.path() };
  }
  if (expression instanceof IdentifierAst) {
    const name = expression.name();
    return name === undefined ? undefined : { kind: 'identifier', name };
  }
  if (expression instanceof ObjectLiteralExprAst) {
    return { kind: 'object' };
  }
  return undefined;
}

function attributeName(name: QualifiedNameAst | undefined): string {
  return name?.path().join('.') ?? '';
}

function renderExpression(expression: ExpressionAst | undefined): string {
  if (expression === undefined) return '';
  return printSyntax(expression.syntax).trim();
}

export function nodePslSpan(node: SyntaxNode, sourceFile: SourceFile): PslSpan {
  const start = node.offset;
  const end = start + node.green.textLength;
  return {
    start: offsetToPslPosition(start, sourceFile),
    end: offsetToPslPosition(end, sourceFile),
  };
}

/** Unsupported-top-level-block diagnostics are anchored to the keyword token. */
export function keywordPslSpan(node: SyntaxNode, keyword: string, sourceFile: SourceFile): PslSpan {
  const start = node.offset;
  const end = start + keyword.length;
  return {
    start: offsetToPslPosition(start, sourceFile),
    end: offsetToPslPosition(end, sourceFile),
  };
}

export function rangeToPslSpan(range: Range, sourceFile: SourceFile): PslSpan {
  return {
    start: offsetToPslPosition(sourceFile.offsetAt(range.start), sourceFile),
    end: offsetToPslPosition(sourceFile.offsetAt(range.end), sourceFile),
  };
}

function offsetToPslPosition(offset: number, sourceFile: SourceFile): PslSpan['start'] {
  const position: Position = sourceFile.positionAt(offset);
  return { offset, line: position.line + 1, column: position.character + 1 };
}
