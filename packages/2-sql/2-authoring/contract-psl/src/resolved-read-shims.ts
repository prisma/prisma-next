import type {
  PslExtensionBlock,
  PslExtensionBlockAttribute,
  PslExtensionBlockAttributeArg,
  PslExtensionBlockParamValue,
  PslSpan,
} from '@prisma-next/psl-parser';
import type {
  ExpressionAst,
  ResolvedAttribute,
  ResolvedDocument,
  ResolvedExtensionBlock,
  ResolvedField,
  ResolvedNamedType,
  ResolvedNamespace,
  SourceFile,
  SyntaxNode,
  SyntaxToken,
  TypeTarget,
} from '@prisma-next/psl-parser/syntax';
import { KeyValuePairAst, SyntaxNode as SyntaxNodeClass } from '@prisma-next/psl-parser/syntax';

/**
 * Internal read surface over {@link ResolvedDocument} for the SQL authoring
 * path: thin helpers and span derivation over the resolver's CST-backed shape.
 * The interpreter, provider, and resolution modules read the document through
 * these helpers. Do not expose outside this package.
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
 * `.kind`. This helper exists so the package's read-path modules import from
 * one internal surface rather than reaching into
 * `@prisma-next/psl-parser/syntax` directly.
 */
export function classifyTypeTarget(target: TypeTarget): TypeTarget {
  return target;
}

/**
 * The single PSL type-name carried by a resolved field, regardless of which
 * `TypeTarget` variant resolution produced. Mirrors the legacy `field.typeName`
 * the resolved read-path replaces: callers classify first then use the name for
 * descriptor lookups.
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

/**
 * The diagnostic span of a single CST token, derived from its absolute source
 * offset through the same `SourceFile` the parse produced. Token equivalent of
 * {@link spanOf} (which operates on a `SyntaxNode`).
 */
function tokenSpan(token: SyntaxToken, sourceFile: SourceFile): PslSpan {
  const endOffset = token.offset + token.text.length;
  const start = sourceFile.positionAt(token.offset);
  const end = sourceFile.positionAt(endOffset);
  return {
    start: { offset: token.offset, line: start.line, column: start.character },
    end: { offset: endOffset, line: end.line, column: end.character },
  };
}

// ---------------------------------------------------------------------------
// Extension-block reading
// ---------------------------------------------------------------------------

/**
 * Reads the `@@`-prefixed block attributes of a generic extension block
 * directly off its CST. The resolver does not parse block-attribute arguments
 * (it only validates `key = value` parameters against a descriptor), so the
 * `@@type("codec")` line is recovered here as a flat
 * `DoubleAt Ident LParen StringLiteral… RParen` token run — the shape the
 * generic-block parser produces inside a `GenericBlockDeclaration`. Only
 * string-literal positional arguments are captured; that is all the SQL
 * `enum2` entity factory consults.
 */
function readBlockAttributes(
  blockSyntax: SyntaxNode,
  sourceFile: SourceFile,
): PslExtensionBlockAttribute[] {
  const attributes: PslExtensionBlockAttribute[] = [];
  const tokens = [...blockSyntax.children()].filter(
    (child): child is SyntaxToken => !(child instanceof SyntaxNodeClass),
  );
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== 'DoubleAt') continue;
    const nameToken = tokens[index + 1];
    if (nameToken?.kind !== 'Ident') continue;
    const args: PslExtensionBlockAttributeArg[] = [];
    let end = index + 1;
    for (let cursor = index + 2; cursor < tokens.length; cursor += 1) {
      const argToken = tokens[cursor];
      if (argToken === undefined) break;
      if (argToken.kind === 'StringLiteral') {
        args.push({
          kind: 'positional',
          value: argToken.text,
          span: tokenSpan(argToken, sourceFile),
        });
      }
      end = cursor;
      if (argToken.kind === 'RParen') break;
    }
    const startOffset = token.offset;
    const lastToken = tokens[end] ?? nameToken;
    const endOffset = lastToken.offset + lastToken.text.length;
    const startPos = sourceFile.positionAt(startOffset);
    const endPos = sourceFile.positionAt(endOffset);
    attributes.push({
      name: nameToken.text,
      args,
      span: {
        start: { offset: startOffset, line: startPos.line, column: startPos.character },
        end: { offset: endOffset, line: endPos.line, column: endPos.character },
      },
    });
  }
  return attributes;
}

/**
 * Adapts a {@link ResolvedExtensionBlock} (which carries only a name +
 * namespace id + CST back-pointer) into the {@link PslExtensionBlock} shape the
 * authoring entity-type factories consume. Members are read from the block's
 * `key = value` / bare-`key` CST entries; a `value`-kind member's `raw` is the
 * verbatim RHS source text (the factory `JSON.parse`s it). Block attributes are
 * read via {@link readBlockAttributes}. The `kind` is set to the resolved
 * namespace-keyed discriminator the consumer routes on (e.g. `enum2`).
 */
/**
 * The keyword token of a generic extension block (`enum2` in
 * `enum2 Priority { … }`), read from its CST. The resolver does not surface the
 * keyword on {@link ResolvedExtensionBlock}, so it is recovered here to route
 * blocks to their target interpreter (the keyword equals the descriptor's
 * `discriminator` for the blocks this package owns).
 */
function extensionBlockKeyword(blockSyntax: SyntaxNode): string | undefined {
  for (const child of blockSyntax.children()) {
    if (child instanceof SyntaxNodeClass) continue;
    if (child.kind === 'Ident') return child.text;
  }
  return undefined;
}

/**
 * Adapts every `keyword`-discriminated extension block of a resolved namespace
 * into the {@link PslExtensionBlock} shape the entity-type factories consume.
 * Used to recover the SQL `enum2` blocks the resolver retained on
 * `ResolvedNamespace.extensionBlocks` but does not parse the members of.
 */
export function extensionBlocksByKeyword(
  namespace: ResolvedNamespace,
  keyword: string,
  sourceFile: SourceFile,
): PslExtensionBlock[] {
  const blocks: PslExtensionBlock[] = [];
  for (const block of namespace.extensionBlocks.values()) {
    if (extensionBlockKeyword(block.syntax) !== keyword) continue;
    blocks.push(extensionBlockFromResolved(block, keyword, sourceFile));
  }
  return blocks;
}

export function extensionBlockFromResolved(
  block: ResolvedExtensionBlock,
  discriminator: string,
  sourceFile: SourceFile,
): PslExtensionBlock {
  const parameters: Record<string, PslExtensionBlockParamValue> = {};
  for (const child of block.syntax.children()) {
    if (!(child instanceof SyntaxNodeClass)) continue;
    const entry = KeyValuePairAst.cast(child);
    if (!entry) continue;
    const key = entry.key()?.token()?.text;
    if (key === undefined || Object.hasOwn(parameters, key)) continue;
    const value = entry.value();
    parameters[key] =
      value === undefined
        ? { kind: 'bare', span: spanOf(entry.syntax, sourceFile) }
        : { kind: 'value', raw: argText(value), span: spanOf(value.syntax, sourceFile) };
  }
  return {
    kind: discriminator,
    name: block.name,
    parameters,
    blockAttributes: readBlockAttributes(block.syntax, sourceFile),
    span: spanOf(block.syntax, sourceFile),
  };
}
