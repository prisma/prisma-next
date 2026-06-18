import {
  type AuthoringPslBlockDescriptor,
  type AuthoringPslBlockDescriptorNamespace,
  isAuthoringPslBlockDescriptor,
} from '@prisma-next/framework-components/authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  type PslBlockParam,
  type PslDiagnostic,
  type PslExtensionBlock,
  type PslExtensionBlockAttribute,
  type PslExtensionBlockParamValue,
  type PslModel,
  type PslSpan,
  UNSPECIFIED_PSL_NAMESPACE_ID,
  validateExtensionBlock,
} from '@prisma-next/framework-components/psl-ast';
import type { Position, SourceFile } from './source-file';
import type { BlockSymbol, SymbolTable } from './symbol-table';
import type { GenericBlockDeclarationAst, KeyValuePairAst } from './syntax/ast/declarations';
import { ArrayLiteralAst, type ExpressionAst } from './syntax/ast/expressions';
import { printSyntax } from './syntax/ast-helpers';
import type { SyntaxNode } from './syntax/red';

function offsetToPslPosition(offset: number, sourceFile: SourceFile): PslSpan['start'] {
  const position: Position = sourceFile.positionAt(offset);
  return { offset, line: position.line + 1, column: position.character + 1 };
}

function nodePslSpanFromSyntax(node: SyntaxNode, sourceFile: SourceFile): PslSpan {
  const start = node.offset;
  const end = start + node.green.textLength;
  return {
    start: offsetToPslPosition(start, sourceFile),
    end: offsetToPslPosition(end, sourceFile),
  };
}

/**
 * Reconstruct a descriptor-driven {@link PslExtensionBlock} from a CST
 * `GenericBlockDeclarationAst` (a `BlockSymbol.node`), using the block's
 * {@link AuthoringPslBlockDescriptor} to classify each member into its proper
 * `ref` / `value` / `option` / `list` / `bare` parameter shape.
 *
 * The symbol table defers block-parameter parsing, so this seam reproduces what
 * the legacy descriptor-driven extension-block parser produced for the validator
 * and the lowering factory: `block.kind` set to the descriptor's discriminator,
 * `@@`-attributes captured generically, and each `key = value` member resolved
 * against the descriptor's parameter kind. Members not declared by the
 * descriptor fall back to a `value`-kind stub so the validator's
 * unknown-parameter detection still fires.
 */
export function reconstructExtensionBlock(
  node: GenericBlockDeclarationAst,
  descriptor: AuthoringPslBlockDescriptor,
  sourceFile: SourceFile,
): PslExtensionBlock {
  const blockName = node.name()?.name() ?? '';

  const blockAttributes: PslExtensionBlockAttribute[] = [];
  for (const attribute of node.attributes()) {
    const name = attribute.name()?.path().join('.') ?? '';
    const args = Array.from(attribute.argList()?.args() ?? [], (arg) => {
      const value = arg.value();
      return {
        kind: 'positional' as const,
        value: value === undefined ? '' : printSyntax(value.syntax).trim(),
        span: nodePslSpanFromSyntax(arg.syntax, sourceFile),
      };
    });
    blockAttributes.push({
      name,
      args,
      span: nodePslSpanFromSyntax(attribute.syntax, sourceFile),
    });
  }

  const parameters: Record<string, PslExtensionBlockParamValue> = {};
  for (const entry of node.entries()) {
    const key = entry.key()?.name();
    if (key === undefined) continue;
    if (Object.hasOwn(parameters, key)) continue;
    const span = nodePslSpanFromSyntax(entry.syntax, sourceFile);
    parameters[key] = reconstructParamValue(entry, descriptor.parameters[key], span, sourceFile);
  }

  return {
    kind: descriptor.discriminator,
    name: blockName,
    parameters,
    blockAttributes,
    span: nodePslSpanFromSyntax(node.syntax, sourceFile),
  };
}

function reconstructParamValue(
  entry: KeyValuePairAst,
  param: PslBlockParam | undefined,
  span: PslSpan,
  sourceFile: SourceFile,
): PslExtensionBlockParamValue {
  const value = entry.value();
  if (value === undefined) {
    return { kind: 'bare', span };
  }
  return reconstructFromExpression(value, param, span, sourceFile);
}

function reconstructFromExpression(
  value: ExpressionAst,
  param: PslBlockParam | undefined,
  span: PslSpan,
  sourceFile: SourceFile,
): PslExtensionBlockParamValue {
  if (param?.kind === 'list') {
    const array = ArrayLiteralAst.cast(value.syntax);
    const items: PslExtensionBlockParamValue[] = [];
    if (array) {
      for (const element of array.elements()) {
        items.push(
          reconstructFromExpression(
            element,
            param.of,
            nodePslSpanFromSyntax(element.syntax, sourceFile),
            sourceFile,
          ),
        );
      }
    }
    return { kind: 'list', items, span };
  }

  const raw = printSyntax(value.syntax).trim();
  switch (param?.kind) {
    case 'ref':
      return { kind: 'ref', identifier: raw, span };
    case 'option':
      return { kind: 'option', token: raw, span };
    default:
      // `value`-kind parameters and members absent from the descriptor both
      // become `value` stubs: the descriptor-free fallback keeps the validator's
      // unknown-parameter detection (key-set difference) working unchanged.
      return { kind: 'value', raw, span };
  }
}

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
 * Reconstruct a top-level {@link BlockSymbol} into a {@link PslExtensionBlock}
 * and run the descriptor-driven {@link validateExtensionBlock} over it, building
 * the ref-resolution context from the symbol table's top-level models so
 * `ref`-kind parameters (e.g. `target = Post`) resolve against the document's
 * declarations. Returns the validator's diagnostics (possibly empty).
 *
 * This is the consumer-side replacement for the validation the legacy parser ran
 * post-parse for descriptor-driven extension blocks; it depends only on the CST
 * + symbol table + framework validator.
 */
export function validateExtensionBlockFromSymbol(input: {
  readonly block: BlockSymbol;
  readonly descriptor: AuthoringPslBlockDescriptor;
  readonly symbolTable: SymbolTable;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly codecLookup: CodecLookup;
}): readonly PslDiagnostic[] {
  const reconstructed = reconstructExtensionBlock(
    input.block.node,
    input.descriptor,
    input.sourceFile,
  );
  const refCtx = buildRefResolutionContext(input.symbolTable);
  return validateExtensionBlock(
    reconstructed,
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
