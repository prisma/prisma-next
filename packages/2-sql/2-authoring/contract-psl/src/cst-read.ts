import type {
  ExpressionAst,
  FieldAttributeAst,
  FieldDeclarationAst,
  ModelAttributeAst,
  QualifiedNameAst,
  Range,
  SourceFile,
  SyntaxNode,
} from '@prisma-next/psl-parser/syntax';
import { printSyntax } from '@prisma-next/psl-parser/syntax';

/**
 * The read set the SQL interpreter helpers need from a field's type annotation,
 * derived directly from the CST `QualifiedNameAst` instead of being pre-split by
 * the legacy parser.
 */
export interface CstTypeAnnotation {
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
 * `x:y:z`). Carries the diagnostic code the legacy interpreter path used for a
 * nested dot-qualified field type, so callers can emit it unchanged.
 */
export interface MalformedQualifiedType {
  readonly ok: false;
  readonly code: 'PSL_INVALID_QUALIFIED_TYPE';
  readonly path: readonly string[];
  readonly range: Range;
}

export type ReadTypeAnnotationResult =
  | { readonly ok: true; readonly annotation: CstTypeAnnotation }
  | MalformedQualifiedType;

/**
 * An attribute argument rendered to the verbatim source-text `value` the legacy
 * attribute-argument shape carried (so the existing string-based arg parsers are
 * reused unchanged).
 */
export interface CstAttributeArg {
  readonly kind: 'positional' | 'named';
  readonly name: string | undefined;
  readonly value: string;
  readonly range: Range;
}

export interface CstAttribute {
  readonly name: string;
  readonly args: readonly CstAttributeArg[];
  readonly range: Range;
}

export function readFieldTypeAnnotation(
  field: FieldDeclarationAst,
  sourceFile: SourceFile,
): ReadTypeAnnotationResult {
  const annotation = field.typeAnnotation();
  const name = annotation?.name();

  if (name?.isOverQualified()) {
    return {
      ok: false,
      code: 'PSL_INVALID_QUALIFIED_TYPE',
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

export function readAttribute(
  attribute: FieldAttributeAst | ModelAttributeAst,
  sourceFile: SourceFile,
): CstAttribute {
  const args: CstAttributeArg[] = [];
  const argList = attribute.argList();
  if (argList) {
    for (const arg of argList.args()) {
      const named = arg.name();
      args.push({
        kind: named ? 'named' : 'positional',
        name: named?.name(),
        value: renderExpression(arg.value()),
        range: nodeRange(arg.syntax, sourceFile),
      });
    }
  }

  return {
    name: attributeName(attribute.name()),
    args,
    range: nodeRange(attribute.syntax, sourceFile),
  };
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
