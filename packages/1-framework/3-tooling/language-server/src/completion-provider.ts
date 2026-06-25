import type { NamespaceSymbol, SymbolTable } from '@prisma-next/psl-parser';
import type { SourceFile } from '@prisma-next/psl-parser/syntax';
import { type CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import type { ModelFieldTypeCompletionContext, PslCompletionContext } from './completion-context';

export interface PslCompletionCandidateSource {
  readonly scalarTypes: readonly string[];
  readonly symbolTable?: SymbolTable;
}

export interface ProvidePslCompletionItemsInput {
  readonly context: PslCompletionContext;
  readonly sourceFile: SourceFile;
  readonly candidates: PslCompletionCandidateSource;
}

type ModelTypeCompletionCandidateCategory =
  | 'configuredScalar'
  | 'topLevelModel'
  | 'topLevelCompositeType'
  | 'scalar'
  | 'typeAlias'
  | 'namespaceModel'
  | 'namespaceCompositeType';

interface ModelTypeCompletionCandidate {
  readonly category: ModelTypeCompletionCandidateCategory;
  readonly label: string;
  readonly insertText: string;
  readonly filterText: string;
  readonly detail: string;
  readonly kind: CompletionItemKind;
}

const categoryOrder: Record<ModelTypeCompletionCandidateCategory, number> = {
  configuredScalar: 0,
  topLevelModel: 1,
  topLevelCompositeType: 2,
  scalar: 3,
  typeAlias: 4,
  namespaceModel: 5,
  namespaceCompositeType: 6,
};

export function providePslCompletionItems(
  input: ProvidePslCompletionItemsInput,
): readonly CompletionItem[] {
  if (input.context.kind === 'unsupported') {
    return [];
  }
  return provideModelFieldTypeCompletionItems(input.context, input.sourceFile, input.candidates);
}

function provideModelFieldTypeCompletionItems(
  context: ModelFieldTypeCompletionContext,
  sourceFile: SourceFile,
  source: PslCompletionCandidateSource,
): readonly CompletionItem[] {
  const replacementRange = {
    start: sourceFile.positionAt(context.offset - context.prefix.name.length),
    end: sourceFile.positionAt(context.offset),
  };

  return candidatesForContext(context, source)
    .filter((candidate) => candidate.filterText.startsWith(context.prefix.name))
    .map((candidate) => ({
      label: candidate.label,
      kind: candidate.kind,
      detail: candidate.detail,
      sortText: sortText(candidate),
      filterText: candidate.filterText,
      textEdit: {
        range: replacementRange,
        newText: candidate.insertText,
      },
    }));
}

function candidatesForContext(
  context: ModelFieldTypeCompletionContext,
  source: PslCompletionCandidateSource,
): readonly ModelTypeCompletionCandidate[] {
  const namespace = context.prefix.namespace;
  if (namespace !== undefined) {
    return namespaceCandidates(source.symbolTable?.topLevel.namespaces[namespace]);
  }

  return [
    ...configuredScalarCandidates(source.scalarTypes),
    ...topLevelSymbolCandidates(source.symbolTable),
    ...allNamespaceCandidates(source.symbolTable),
  ];
}

function configuredScalarCandidates(
  scalarTypes: readonly string[],
): readonly ModelTypeCompletionCandidate[] {
  return sortedUnique(scalarTypes).map((name) => ({
    category: 'configuredScalar',
    label: name,
    insertText: name,
    filterText: name,
    detail: 'Configured scalar type',
    kind: CompletionItemKind.Keyword,
  }));
}

function topLevelSymbolCandidates(
  symbolTable: SymbolTable | undefined,
): readonly ModelTypeCompletionCandidate[] {
  if (symbolTable === undefined) {
    return [];
  }
  const { topLevel } = symbolTable;
  return [
    ...symbolCandidates(
      recordNames(topLevel.models),
      'topLevelModel',
      'Model',
      CompletionItemKind.Class,
    ),
    ...symbolCandidates(
      recordNames(topLevel.compositeTypes),
      'topLevelCompositeType',
      'Composite type',
      CompletionItemKind.Struct,
    ),
    ...symbolCandidates(
      recordNames(topLevel.scalars),
      'scalar',
      'Scalar type',
      CompletionItemKind.Unit,
    ),
    ...symbolCandidates(
      recordNames(topLevel.typeAliases),
      'typeAlias',
      'Type alias',
      CompletionItemKind.Reference,
    ),
  ];
}

function allNamespaceCandidates(
  symbolTable: SymbolTable | undefined,
): readonly ModelTypeCompletionCandidate[] {
  if (symbolTable === undefined) {
    return [];
  }
  return Object.values(symbolTable.topLevel.namespaces)
    .sort((left, right) => compareNames(left.name, right.name))
    .flatMap(namespaceCandidatesForBareContext);
}

function namespaceCandidates(
  namespace: NamespaceSymbol | undefined,
): readonly ModelTypeCompletionCandidate[] {
  if (namespace === undefined) {
    return [];
  }
  return [
    ...symbolCandidates(
      recordNames(namespace.models),
      'namespaceModel',
      `Model in namespace ${namespace.name}`,
      CompletionItemKind.Class,
    ),
    ...symbolCandidates(
      recordNames(namespace.compositeTypes),
      'namespaceCompositeType',
      `Composite type in namespace ${namespace.name}`,
      CompletionItemKind.Struct,
    ),
  ];
}

function namespaceCandidatesForBareContext(
  namespace: NamespaceSymbol,
): readonly ModelTypeCompletionCandidate[] {
  return [
    ...qualifiedNamespaceCandidates(
      namespace.name,
      recordNames(namespace.models),
      'namespaceModel',
      `Model in namespace ${namespace.name}`,
      CompletionItemKind.Class,
    ),
    ...qualifiedNamespaceCandidates(
      namespace.name,
      recordNames(namespace.compositeTypes),
      'namespaceCompositeType',
      `Composite type in namespace ${namespace.name}`,
      CompletionItemKind.Struct,
    ),
  ];
}

function symbolCandidates(
  names: readonly string[],
  category: ModelTypeCompletionCandidateCategory,
  detail: string,
  kind: CompletionItemKind,
): readonly ModelTypeCompletionCandidate[] {
  return names.map((name) => ({
    category,
    label: name,
    insertText: name,
    filterText: name,
    detail,
    kind,
  }));
}

function qualifiedNamespaceCandidates(
  namespace: string,
  names: readonly string[],
  category: ModelTypeCompletionCandidateCategory,
  detail: string,
  kind: CompletionItemKind,
): readonly ModelTypeCompletionCandidate[] {
  return names.map((name) => {
    const qualifiedName = `${namespace}.${name}`;
    return {
      category,
      label: qualifiedName,
      insertText: qualifiedName,
      filterText: qualifiedName,
      detail,
      kind,
    };
  });
}

function recordNames<T extends { readonly name: string }>(
  record: Record<string, T>,
): readonly string[] {
  return Object.values(record)
    .map((symbol) => symbol.name)
    .sort(compareNames);
}

function sortedUnique(names: readonly string[]): readonly string[] {
  return [...new Set(names)].sort(compareNames);
}

function sortText(candidate: ModelTypeCompletionCandidate): string {
  return `${categoryOrder[candidate.category]}:${candidate.label}`;
}

function compareNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
