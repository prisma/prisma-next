import type {
  PslExtensionBlock,
  PslExtensionBlockAttribute,
  PslExtensionBlockAttributeArg,
  PslExtensionBlockParamValue,
  PslSpan,
} from '@prisma-next/psl-parser';
import type {
  ResolvedExtensionBlock,
  ResolvedField,
  ResolvedNamespace,
  SourceFile,
} from '@prisma-next/psl-parser/syntax';
import {
  GenericBlockDeclarationAst,
  KeyValuePairAst,
  printSyntax,
  StringLiteralExprAst,
  SyntaxNode,
} from '@prisma-next/psl-parser/syntax';

/**
 * Read path over a {@link ResolvedDocument}'s CST for the SQL authoring path:
 * the diagnostic-span derivation, the single field type-name accessor, and the
 * generic extension-block readers that recover the config-layer
 * {@link PslExtensionBlock} shape the entity-type factories consume. Do not
 * expose outside this package.
 */

/**
 * The single PSL type-name carried by a resolved field, regardless of which
 * `TypeTarget` variant resolution produced. Callers classify the target first,
 * then use the name for descriptor lookups.
 *
 * - `scalar` → scalar name (e.g. `"String"`)
 * - `ref` → declaration name from the coordinate (e.g. `"User"`)
 * - `crossSpace` → the written type name (e.g. `"User"`)
 * - `constructor` → dot-joined path (e.g. `"temporal.cuid2"`)
 * - `block` → the block name (e.g. `"Priority"` for a field typed by an `enum`)
 * - `unresolved` → the written type name (e.g. `"UnknownType"`)
 */
export function fieldTypeName(field: ResolvedField): string {
  const target = field.type.target;
  if (target.kind === 'scalar') return target.name;
  if (target.kind === 'ref') return target.coord.name;
  if (target.kind === 'crossSpace') return target.typeName;
  if (target.kind === 'constructor') return target.path.join('.');
  if (target.kind === 'block') return target.name;
  return target.typeName;
}

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
 * Reads the `@@`-prefixed block attributes of a generic extension block off its
 * CST. The parser now wraps each `@@attr(args)` line inside a generic block in
 * the same `ModelAttribute` node that model/enum/composite blocks use, so the
 * `@@type("codec")` line is read through {@link ModelAttributeAst}: the name
 * from the qualified-name's last segment, and string-literal positional
 * arguments from `argList().args()`. Only string-literal positional arguments
 * are captured; that is all the SQL `enum2` entity factory consults. The
 * argument `value` is the raw, quoted source text (e.g. `"pg/text@1"`) — the
 * entity factory strips the quotes itself, mirroring the legacy reader's
 * behaviour.
 */
function readBlockAttributes(
  blockSyntax: SyntaxNode,
  sourceFile: SourceFile,
): PslExtensionBlockAttribute[] {
  const block = GenericBlockDeclarationAst.cast(blockSyntax);
  if (block === undefined) return [];
  const attributes: PslExtensionBlockAttribute[] = [];
  for (const attribute of block.attributes()) {
    const name = attribute.name()?.identifier()?.token()?.text;
    if (name === undefined) continue;
    const args: PslExtensionBlockAttributeArg[] = [];
    for (const arg of attribute.argList()?.args() ?? []) {
      const value = arg.value();
      if (value === undefined) continue;
      const literal = StringLiteralExprAst.cast(value.syntax);
      if (literal === undefined) continue;
      args.push({
        kind: 'positional',
        value: printSyntax(value.syntax),
        span: spanOf(value.syntax, sourceFile),
      });
    }
    attributes.push({
      name,
      args,
      span: spanOf(attribute.syntax, sourceFile),
    });
  }
  return attributes;
}

/**
 * The keyword token of a generic extension block (`enum2` in
 * `enum2 Priority { … }`), read from its CST. The resolver does not surface the
 * keyword on {@link ResolvedExtensionBlock}, so it is recovered here to route
 * blocks to their target interpreter (the keyword equals the descriptor's
 * `discriminator` for the blocks this package owns).
 */
function extensionBlockKeyword(blockSyntax: SyntaxNode): string | undefined {
  for (const child of blockSyntax.children()) {
    if (child instanceof SyntaxNode) continue;
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

/**
 * Adapts a {@link ResolvedExtensionBlock} (which carries only a name +
 * namespace id + CST back-pointer) into the {@link PslExtensionBlock} shape the
 * authoring entity-type factories consume. Members are read from the block's
 * `key = value` / bare-`key` CST entries; a `value`-kind member's `raw` is the
 * verbatim RHS source text (the factory `JSON.parse`s it). Block attributes are
 * read via {@link readBlockAttributes}. The `kind` is set to the resolved
 * namespace-keyed discriminator the consumer routes on (e.g. `enum2`).
 */
function extensionBlockFromResolved(
  block: ResolvedExtensionBlock,
  discriminator: string,
  sourceFile: SourceFile,
): PslExtensionBlock {
  const parameters: Record<string, PslExtensionBlockParamValue> = {};
  for (const child of block.syntax.children()) {
    if (!(child instanceof SyntaxNode)) continue;
    const entry = KeyValuePairAst.cast(child);
    if (!entry) continue;
    const key = entry.key()?.token()?.text;
    if (key === undefined || Object.hasOwn(parameters, key)) continue;
    const value = entry.value();
    parameters[key] =
      value === undefined
        ? { kind: 'bare', span: spanOf(entry.syntax, sourceFile) }
        : { kind: 'value', raw: printSyntax(value.syntax), span: spanOf(value.syntax, sourceFile) };
  }
  return {
    kind: discriminator,
    name: block.name,
    parameters,
    blockAttributes: readBlockAttributes(block.syntax, sourceFile),
    span: spanOf(block.syntax, sourceFile),
  };
}
