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
  // Ref validation checks only `entries[refKind][name]` key presence, so model
  // stubs are enough for top-level declarations in the `__unspecified__` bucket.
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
