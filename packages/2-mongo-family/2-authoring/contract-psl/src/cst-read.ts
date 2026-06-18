import type { PslSpan } from '@prisma-next/psl-parser';
import type {
  AttributeArgListAst,
  ExpressionAst,
  FieldAttributeAst,
  FieldDeclarationAst,
  ModelAttributeAst,
  Position,
  QualifiedNameAst,
  Range,
  SourceFile,
  SyntaxNode,
} from '@prisma-next/psl-parser/syntax';
import { printSyntax } from '@prisma-next/psl-parser/syntax';
import type { CstAttributeArgView, CstAttributeView } from './cst-read-views';

/**
 * The read set the Mongo interpreter helpers need from a field's type
 * annotation, derived directly from the CST `QualifiedNameAst`. A trimmed copy
 * of the SQL adapter: Mongo has no type constructors, so the constructor-call
 * reader is absent, but the splitter still reports `isConstructor`/`path` for
 * parity with the shared annotation shape.
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

/**
 * Read a `FieldAttributeAst`/`ModelAttributeAst` into the `PslSpan`-spanned
 * `CstAttributeView` the interpreter helpers consume.
 */
export function readAttributeView(
  attribute: FieldAttributeAst | ModelAttributeAst,
  sourceFile: SourceFile,
): CstAttributeView {
  return {
    name: attributeName(attribute.name()),
    args: readArgListView(attribute.argList(), sourceFile),
    span: nodePslSpan(attribute.syntax, sourceFile),
  };
}

function readArgListView(
  argList: AttributeArgListAst | undefined,
  sourceFile: SourceFile,
): readonly CstAttributeArgView[] {
  if (argList === undefined) return [];
  const args: CstAttributeArgView[] = [];
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
 * Map a CST node to the legacy `PslSpan` (1-based line/column + byte offset) the
 * interpreter and its helpers carry on diagnostics. The wiring-seam map between
 * the parser's 0-based `Range` and the legacy span shape.
 */
export function nodePslSpan(node: SyntaxNode, sourceFile: SourceFile): PslSpan {
  const start = node.offset;
  const end = start + node.green.textLength;
  return {
    start: offsetToPslPosition(start, sourceFile),
    end: offsetToPslPosition(end, sourceFile),
  };
}

/** Map a parser `Range` to the legacy `PslSpan` shape. */
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
