import {
  type AuthoringPslBlockDescriptor,
  type AuthoringPslBlockDescriptorNamespace,
  isAuthoringPslBlockDescriptor,
} from '@prisma-next/framework-components/authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  type PslDiagnostic,
  type PslModel,
  type PslSpan,
  UNSPECIFIED_PSL_NAMESPACE_ID,
  validateExtensionBlock,
} from '@prisma-next/framework-components/psl-ast';
import type { SourceFile } from './source-file';
import type { BlockSymbol, SymbolTable } from './symbol-table';

/**
 * Resolve the descriptor that claims `keyword` from a composed
 * {@link AuthoringPslBlockDescriptorNamespace}. Returns `undefined` when no
 * registered descriptor matches.
 */
export function findBlockDescriptor(
  descriptors: AuthoringPslBlockDescriptorNamespace | undefined,
  keyword: string,
): AuthoringPslBlockDescriptor | undefined {
  if (descriptors === undefined) return undefined;
  for (const value of Object.values(descriptors)) {
    if (value === undefined) continue;
    if (isAuthoringPslBlockDescriptor(value)) {
      if (value.keyword === keyword) return value;
      continue;
    }
    const nested = findBlockDescriptor(value, keyword);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/**
 * Run the descriptor-driven {@link validateExtensionBlock} over a
 * {@link BlockSymbol}'s already-resolved `block` ({@link PslExtensionBlock},
 * reconstructed by `buildSymbolTable`), building the ref-resolution context from
 * the symbol table's top-level models so `ref`-kind parameters (e.g.
 * `target = Post`) resolve against the document's declarations. Returns the
 * validator's diagnostics (possibly empty).
 *
 * This is the consumer-side replacement for the validation the legacy parser ran
 * post-parse for descriptor-driven extension blocks; it depends only on the
 * resolved block + symbol table + framework validator.
 */
export function validateExtensionBlockFromSymbol(input: {
  readonly block: BlockSymbol;
  readonly descriptor: AuthoringPslBlockDescriptor;
  readonly symbolTable: SymbolTable;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly codecLookup: CodecLookup;
}): readonly PslDiagnostic[] {
  const refCtx = buildRefResolutionContext(input.symbolTable);
  return validateExtensionBlock(
    input.block.block,
    input.descriptor,
    input.sourceId,
    input.codecLookup,
    refCtx,
  );
}

const ZERO_SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

function buildRefResolutionContext(symbolTable: SymbolTable): {
  ownerNamespace: ReturnType<typeof makePslNamespace>;
  allNamespaces: readonly ReturnType<typeof makePslNamespace>[];
} {
  // The validator resolves `same-namespace`/`same-space` refs by checking
  // `entries[refKind][name]` for key presence only — so a minimal model stub
  // keyed by name is sufficient. Top-level declarations live in the synthesised
  // `__unspecified__` namespace, matching the legacy bucket the validator saw.
  const modelStubs: PslModel[] = Object.values(symbolTable.topLevel.models).map((model) => ({
    kind: 'model',
    name: model.name,
    fields: [],
    attributes: [],
    span: ZERO_SPAN,
  }));
  const ownerNamespace = makePslNamespace({
    kind: 'namespace',
    name: UNSPECIFIED_PSL_NAMESPACE_ID,
    entries: makePslNamespaceEntries(modelStubs, [], []),
    span: ZERO_SPAN,
  });
  return { ownerNamespace, allNamespaces: [ownerNamespace] };
}
