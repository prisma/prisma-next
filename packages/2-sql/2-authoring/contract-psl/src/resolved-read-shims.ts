import type { PslSpan } from '@prisma-next/psl-parser';
import type {
  ExpressionAst,
  ResolvedAttribute,
  ResolvedDocument,
  ResolvedField,
  ResolvedNamedType,
  ResolvedNamespace,
  SourceFile,
  SyntaxNode,
  TypeTarget,
} from '@prisma-next/psl-parser/syntax';

/**
 * Internal read surface over {@link ResolvedDocument} for the SQL authoring
 * path. D2–D4 consume these helpers when migrating off the legacy
 * `PslDocumentAst` read-path. Do not expose outside this package.
 */

// ---------------------------------------------------------------------------
// Namespace / declaration access
// ---------------------------------------------------------------------------

/**
 * The namespace map of a `ResolvedDocument`, keyed by namespace id.
 * Top-level declarations live under `UNSPECIFIED_PSL_NAMESPACE_ID`.
 */
export function namespacesOf(doc: ResolvedDocument): ReadonlyMap<string, ResolvedNamespace> {
  return doc.namespaces;
}

/**
 * The named-types map of a `ResolvedDocument` (declarations from a
 * `types { … }` block), keyed by type name.
 */
export function namedTypes(doc: ResolvedDocument): ReadonlyMap<string, ResolvedNamedType> {
  return doc.namedTypes;
}

// ---------------------------------------------------------------------------
// TypeTarget classification
// ---------------------------------------------------------------------------

/**
 * Passes through the `TypeTarget` discriminated union unchanged. The
 * `TypeTarget` type is already a discriminated union — callers switch on
 * `.kind`. This helper exists so D2–D4 import from one internal surface
 * rather than mixing direct `@prisma-next/psl-parser/syntax` imports with
 * legacy-path imports.
 */
export function classifyTypeTarget(target: TypeTarget): TypeTarget {
  return target;
}

/**
 * The single PSL type-name carried by a resolved field, regardless of which
 * `TypeTarget` variant resolution produced. Mirrors the legacy
 * `field.typeName` that D2–D4 replace: callers classify first then use the
 * name for descriptor lookups.
 *
 * - `scalar` → scalar name (e.g. `"String"`)
 * - `ref` → declaration name from the coordinate (e.g. `"User"`)
 * - `crossSpace` → the written type name (e.g. `"User"`)
 * - `constructor` → dot-joined path (e.g. `"temporal.cuid2"`)
 * - `unresolved` → the written type name (e.g. `"UnknownType"`)
 */
export function fieldTypeName(field: ResolvedField): string {
  const target = field.type.target;
  if (target.kind === 'scalar') return target.name;
  if (target.kind === 'ref') return target.coord.name;
  if (target.kind === 'crossSpace') return target.typeName;
  if (target.kind === 'constructor') return target.path.join('.');
  return target.typeName;
}

// ---------------------------------------------------------------------------
// Attribute access
// ---------------------------------------------------------------------------

/**
 * Finds an attribute by name from a resolved attribute list.
 * Returns `undefined` when the attribute is absent.
 */
export function getAttribute(
  attributes: readonly ResolvedAttribute[],
  name: string,
): ResolvedAttribute | undefined {
  return attributes.find((attr) => attr.name === name);
}

/**
 * Raw source text of an argument expression — the concatenated token text of
 * the CST node, which reproduces the source slice the node spans (leaf
 * expression nodes carry no leading/trailing trivia, so this is already
 * trimmed). This matches the raw, trimmed argument text the legacy parser
 * exposed as its positional/named arg value: quotes and brackets are
 * preserved; downstream parsers strip them as needed.
 */
export function argText(value: ExpressionAst): string {
  let text = '';
  for (const token of value.syntax.tokens()) {
    text += token.text;
  }
  return text;
}

/**
 * Raw text of a named argument in a `ResolvedAttribute`, or `undefined` when
 * the named argument is absent. Quotes and delimiters are preserved — callers
 * strip them as needed (mirrors `getNamedArgument` from `psl-attribute-parsing`
 * for the legacy read path).
 */
export function getNamedArgText(attr: ResolvedAttribute, name: string): string | undefined {
  const arg = attr.args.find((a) => a.name === name);
  return arg === undefined ? undefined : argText(arg.value);
}

// ---------------------------------------------------------------------------
// Span derivation from CST
// ---------------------------------------------------------------------------

/**
 * The diagnostic span of a resolved entity, derived from its CST `syntax`
 * back-pointer. `ResolvedDocument` entities carry a syntax node rather than
 * a pre-computed span, so the location is recovered from the node's source
 * offset through the same `SourceFile` the parse produced.
 */
export function spanOf(node: SyntaxNode, sourceFile: SourceFile): PslSpan {
  const start = sourceFile.positionAt(node.offset);
  const end = sourceFile.positionAt(node.offset + node.textLength);
  return {
    start: { offset: node.offset, line: start.line, column: start.character },
    end: { offset: node.offset + node.textLength, line: end.line, column: end.character },
  };
}
