import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type {
  PslExtensionBlock,
  PslExtensionBlockAttribute,
  PslExtensionBlockParamValue,
} from '@prisma-next/psl-parser';
import type { GenericBlockDeclarationAst, SourceFile } from '@prisma-next/psl-parser/syntax';
import { printSyntax } from '@prisma-next/psl-parser/syntax';
import { nodePslSpan, rangeToPslSpan, readAttribute } from './cst-read';

/**
 * Reconstruct the legacy `PslExtensionBlock` shape the SQL enum factory consumes
 * from a CST `GenericBlockDeclarationAst` (the symbol table's `BlockSymbol.node`).
 *
 * The symbol table defers block-parameter parsing, so this seam reproduces what
 * the legacy `parsePslDocument` extension-block parser produced for the factory:
 * `@@type(...)` block attributes (via the dispatch-1 attribute reader) and the
 * member `parameters` map (bare members → `{ kind: 'bare' }`, `key = value`
 * members → `{ kind: 'value', raw }` where `raw` is the verbatim source value,
 * matching the legacy descriptor-free path for a variadic block). First
 * occurrence of a duplicate member name wins, as the legacy parser did; each
 * later occurrence is dropped and flagged with `PSL_EXTENSION_DUPLICATE_PARAMETER`
 * into the supplied `diagnostics` sink (parity with the legacy
 * `pslBlockDescriptors`-driven parser).
 */
export function reconstructExtensionBlock(
  node: GenericBlockDeclarationAst,
  sourceFile: SourceFile,
  diagnostics: ContractSourceDiagnostic[],
  sourceId: string,
): PslExtensionBlock {
  const keyword = node.keyword()?.text ?? '';
  const blockName = node.name()?.name() ?? '';
  const blockAttributes: PslExtensionBlockAttribute[] = [];
  for (const attribute of node.attributes()) {
    const read = readAttribute(attribute, sourceFile);
    blockAttributes.push({
      name: read.name,
      args: read.args
        .filter((arg) => arg.kind === 'positional')
        .map((arg) => ({
          kind: 'positional' as const,
          value: arg.value,
          span: rangeToPslSpan(arg.range, sourceFile),
        })),
      span: rangeToPslSpan(read.range, sourceFile),
    });
  }

  const parameters: Record<string, PslExtensionBlockParamValue> = {};
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
