import type { PslSpan } from '@prisma-next/framework-components/psl-ast';
import type { Position, Range, SourceFile } from './source-file';
import type {
  AttributeArgListAst,
  FieldAttributeAst,
  ModelAttributeAst,
} from './syntax/ast/attributes';
import type { FieldDeclarationAst } from './syntax/ast/declarations';
import type { ExpressionAst } from './syntax/ast/expressions';
import type { QualifiedNameAst } from './syntax/ast/qualified-name';
import type { TypeAnnotationAst } from './syntax/ast/type-annotation';
import { printSyntax } from './syntax/ast-helpers';
import type { SyntaxNode } from './syntax/red';

/**
 * A single attribute argument resolved off the CST, with its value rendered to
 * the verbatim source text the legacy `PslAttributeArgument.value` carried (so
 * the interpreters' existing string-based argument parsers consume it unchanged).
 */
export interface ResolvedAttributeArg {
  readonly kind: 'positional' | 'named';
  readonly name?: string;
  readonly value: string;
  readonly span: PslSpan;
}

/**
 * A `@`/`@@` attribute resolved off the CST: a dotted name (e.g. `db.VarChar`)
 * plus its rendered argument list, with `PslSpan` diagnostic spans.
 */
export interface ResolvedAttribute {
  readonly name: string;
  readonly args: readonly ResolvedAttributeArg[];
  readonly span: PslSpan;
}

/** A `Type(args…)` constructor call (e.g. `Vector(1536)`) resolved off the CST. */
export interface ResolvedTypeConstructorCall {
  readonly path: readonly string[];
  readonly args: readonly ResolvedAttributeArg[];
  readonly span: PslSpan;
}

/**
 * The resolved type-annotation read-set, derived directly from the CST
 * `QualifiedNameAst` (the split the legacy parser pre-computed into
 * `PslField.typeName`/`typeNamespaceId`/`typeContractSpaceId`).
 */
export interface ResolvedTypeAnnotation {
  readonly typeName: string | undefined;
  readonly typeNamespaceId: string | undefined;
  readonly typeContractSpaceId: string | undefined;
  readonly optional: boolean;
  readonly list: boolean;
  readonly isConstructor: boolean;
  readonly path: readonly string[];
}

/**
 * A malformed qualified type (an over-qualified name such as `a.b.c` or
 * `x:y:z`). Carries the `Range` so callers can emit `PSL_INVALID_QUALIFIED_TYPE`
 * with the offending name's span.
 */
export interface MalformedQualifiedType {
  readonly ok: false;
  readonly path: readonly string[];
  readonly range: Range;
}

export type ResolveTypeAnnotationResult =
  | { readonly ok: true; readonly annotation: ResolvedTypeAnnotation }
  | MalformedQualifiedType;

/**
 * Resolve a field's type annotation into the {@link ResolvedTypeAnnotation}
 * read-set, or a {@link MalformedQualifiedType} signal when the type is
 * over-qualified (more than one namespace/space qualifier). Never throws.
 */
export function resolveFieldTypeAnnotation(
  field: FieldDeclarationAst,
  sourceFile: SourceFile,
): ResolveTypeAnnotationResult {
  const annotation = field.typeAnnotation();
  const name = annotation?.name();

  if (name?.isOverQualified()) {
    return {
      ok: false,
      path: name.path(),
      range: nodeRange(name.syntax, sourceFile),
    };
  }

  return {
    ok: true,
    annotation: {
      typeName: name?.identifier()?.name(),
      typeNamespaceId: name?.namespace()?.name(),
      typeContractSpaceId: name?.space()?.name(),
      optional: annotation?.isOptional() ?? false,
      list: annotation?.isList() ?? false,
      isConstructor: annotation?.isConstructor() ?? false,
      path: name?.path() ?? [],
    },
  };
}

/** Resolve a single `@`/`@@` attribute into a {@link ResolvedAttribute}. */
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

/** Resolve every `@`/`@@` attribute on a declaration into {@link ResolvedAttribute}s. */
export function readResolvedAttributes(
  attributes: Iterable<FieldAttributeAst | ModelAttributeAst>,
  sourceFile: SourceFile,
): readonly ResolvedAttribute[] {
  return Array.from(attributes, (attribute) => readResolvedAttribute(attribute, sourceFile));
}

/**
 * Resolve a constructor type annotation (`Vector(1536)`) into a
 * {@link ResolvedTypeConstructorCall}, or `undefined` when the annotation is not
 * a constructor.
 */
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
    args.push({
      kind: name !== undefined ? 'named' : 'positional',
      ...(name !== undefined ? { name } : {}),
      value: renderExpression(arg.value()),
      span: nodePslSpan(arg.syntax, sourceFile),
    });
  }
  return args;
}

function attributeName(name: QualifiedNameAst | undefined): string {
  return name?.path().join('.') ?? '';
}

function renderExpression(expression: ExpressionAst | undefined): string {
  if (expression === undefined) return '';
  return printSyntax(expression.syntax).trim();
}

function nodeRange(node: SyntaxNode, sourceFile: SourceFile): Range {
  const start = node.offset;
  const end = start + node.green.textLength;
  return {
    start: sourceFile.positionAt(start),
    end: sourceFile.positionAt(end),
  };
}

/**
 * Map a CST node to a {@link PslSpan} (1-based line/column + byte offset), the
 * span shape carried on the resolved symbol-table attribute/constructor reads.
 */
export function nodePslSpan(node: SyntaxNode, sourceFile: SourceFile): PslSpan {
  const start = node.offset;
  const end = start + node.green.textLength;
  return {
    start: offsetToPslPosition(start, sourceFile),
    end: offsetToPslPosition(end, sourceFile),
  };
}

/** Map a parser `Range` (0-based positions) to the {@link PslSpan} shape. */
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
