import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import { nodePslSpan, type PslSpan, readResolvedAttribute } from '@prisma-next/psl-parser';
import type { GenericBlockDeclarationAst, SourceFile } from '@prisma-next/psl-parser/syntax';
import { printSyntax } from '@prisma-next/psl-parser/syntax';

/**
 * Package-local structural mirror of the extension-block shape the SQL enum
 * factory (`2-sql/9-family`) consumes. Declared here — rather than importing the
 * framework's legacy extension-block types — so the SQL `contract-psl` src no
 * longer references the legacy object names (slice DoD); the shape stays
 * structurally assignable to the factory's extension-block parameter.
 */
interface ReconstructedBlockAttribute {
  readonly name: string;
  readonly args: readonly {
    readonly kind: 'positional';
    readonly value: string;
    readonly span: PslSpan;
  }[];
  readonly span: PslSpan;
}

type ReconstructedParamValue =
  | { readonly kind: 'bare'; readonly span: PslSpan }
  | { readonly kind: 'value'; readonly raw: string; readonly span: PslSpan };

export interface ReconstructedExtensionBlock {
  readonly kind: string;
  readonly name: string;
  readonly parameters: Record<string, ReconstructedParamValue>;
  readonly blockAttributes: readonly ReconstructedBlockAttribute[];
  readonly span: PslSpan;
}

/**
 * Reconstruct the extension-block shape the SQL enum factory consumes from a CST
 * `GenericBlockDeclarationAst` (the symbol table's `BlockSymbol.node`).
 *
 * The symbol table defers block-parameter parsing, so this seam reproduces what
 * the legacy extension-block parser produced for the factory:
 * `@@type(...)` block attributes (via the dispatch-1 attribute reader) and the
 * member `parameters` map (bare members → `{ kind: 'bare' }`, `key = value`
 * members → `{ kind: 'value', raw }` where `raw` is the verbatim source value,
 * matching the legacy descriptor-free path for a variadic block). First
 * occurrence of a duplicate member name wins, as the legacy parser did; each
 * later occurrence is dropped and flagged with `PSL_EXTENSION_DUPLICATE_PARAMETER`
 * into the supplied `diagnostics` sink (parity with the legacy
 * descriptor-driven parser).
 */
export function reconstructExtensionBlock(
  node: GenericBlockDeclarationAst,
  sourceFile: SourceFile,
  diagnostics: ContractSourceDiagnostic[],
  sourceId: string,
): ReconstructedExtensionBlock {
  const keyword = node.keyword()?.text ?? '';
  const blockName = node.name()?.name() ?? '';
  const blockAttributes: ReconstructedBlockAttribute[] = [];
  for (const attribute of node.attributes()) {
    const read = readResolvedAttribute(attribute, sourceFile);
    blockAttributes.push({
      name: read.name,
      args: read.args
        .filter((arg) => arg.kind === 'positional')
        .map((arg) => ({
          kind: 'positional' as const,
          value: arg.value,
          span: arg.span,
        })),
      span: read.span,
    });
  }

  const parameters: Record<string, ReconstructedParamValue> = {};
  for (const entry of node.entries()) {
    const key = entry.key()?.name();
    if (key === undefined) continue;
    const span = nodePslSpan(entry.syntax, sourceFile);
    if (Object.hasOwn(parameters, key)) {
      diagnostics.push({
        code: 'PSL_EXTENSION_DUPLICATE_PARAMETER',
        message: `Duplicate parameter "${key}" in "${keyword}" block "${blockName}"; first occurrence wins`,
        sourceId,
        span,
      });
      continue;
    }
    const value = entry.value();
    parameters[key] =
      value === undefined
        ? { kind: 'bare', span }
        : { kind: 'value', raw: printSyntax(value.syntax).trim(), span };
  }

  return {
    kind: 'enum',
    name: blockName,
    parameters,
    blockAttributes,
    span: nodePslSpan(node.syntax, sourceFile),
  };
}
