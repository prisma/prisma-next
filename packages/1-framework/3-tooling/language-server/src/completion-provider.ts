import {
  type AuthoringPslBlockDescriptorNamespace,
  isAuthoringPslBlockDescriptor,
} from '@prisma-next/framework-components/authoring';
import {
  findBlockDescriptor,
  type NamespaceSymbol,
  type SymbolTable,
} from '@prisma-next/psl-parser';
import type { SourceFile } from '@prisma-next/psl-parser/syntax';
import { type CompletionItem, CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import type {
  DeclarationKeywordCompletionContext,
  GenericBlockParameterCompletionContext,
  ModelFieldTypeCompletionContext,
  PslCompletionContext,
} from './completion-context';

export interface PslCompletionCandidateSource {
  readonly scalarTypes: readonly string[];
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly symbolTable?: SymbolTable;
}

export interface ProvidePslCompletionItemsInput {
  readonly context: PslCompletionContext;
  readonly sourceFile: SourceFile;
  readonly candidates: PslCompletionCandidateSource;
  readonly clientSupportsSnippets: boolean;
}

type DeclarationKeywordCompletionCandidateCategory = 'native' | 'genericBlock';

type ModelTypeCompletionCandidateCategory =
  | 'configuredScalar'
  | 'topLevelModel'
  | 'topLevelCompositeType'
  | 'scalar'
  | 'typeAlias'
  | 'namespace'
  | 'namespaceModel'
  | 'namespaceCompositeType';

interface DeclarationKeywordCompletionCandidate {
  readonly category: DeclarationKeywordCompletionCandidateCategory;
  readonly label: string;
  readonly insertText: string;
  readonly snippetText: string;
  readonly detail: string;
  readonly kind: CompletionItemKind;
}

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
  namespace: 5,
  namespaceModel: 6,
  namespaceCompositeType: 7,
};

const declarationKeywordCategoryOrder: Record<
  DeclarationKeywordCompletionCandidateCategory,
  number
> = {
  native: 0,
  genericBlock: 1,
};

const nameSnippetPlaceholder = '$' + '{1:Name}';
const namespaceSnippetPlaceholder = '$' + '{1:name}';

const documentNativeDeclarationKeywords: readonly DeclarationKeywordCompletionCandidate[] = [
  nativeDeclarationKeyword('model', 'model ', `model ${nameSnippetPlaceholder} {\n  $0\n}`),
  nativeDeclarationKeyword('type', 'type ', `type ${nameSnippetPlaceholder} {\n  $0\n}`),
  nativeDeclarationKeyword('types', 'types ', 'types {\n  $0\n}'),
  nativeDeclarationKeyword(
    'namespace',
    'namespace ',
    `namespace ${namespaceSnippetPlaceholder} {\n  $0\n}`,
  ),
];

const namespaceNativeDeclarationKeywords: readonly DeclarationKeywordCompletionCandidate[] = [
  nativeDeclarationKeyword('model', 'model ', `model ${nameSnippetPlaceholder} {\n  $0\n}`),
  nativeDeclarationKeyword('type', 'type ', `type ${nameSnippetPlaceholder} {\n  $0\n}`),
];

export function providePslCompletionItems(
  input: ProvidePslCompletionItemsInput,
): readonly CompletionItem[] {
  if (input.context.kind === 'unsupported') {
    return [];
  }
  if (input.context.kind === 'declarationKeyword') {
    return provideDeclarationKeywordCompletionItems(
      input.context,
      input.sourceFile,
      input.candidates,
      input.clientSupportsSnippets,
    );
  }
  if (input.context.kind === 'genericBlockParameter') {
    return provideGenericBlockParameterCompletionItems(
      input.context,
      input.sourceFile,
      input.candidates,
    );
  }
  return provideModelFieldTypeCompletionItems(input.context, input.sourceFile, input.candidates);
}

function provideDeclarationKeywordCompletionItems(
  context: DeclarationKeywordCompletionContext,
  sourceFile: SourceFile,
  source: PslCompletionCandidateSource,
  clientSupportsSnippets: boolean,
): readonly CompletionItem[] {
  const replacementRange = {
    start: sourceFile.positionAt(context.replacementStartOffset),
    end: sourceFile.positionAt(context.offset),
  };

  return declarationKeywordCandidates(context.scope, source)
    .filter((candidate) => candidate.label.startsWith(context.prefix))
    .map((candidate) => ({
      label: candidate.label,
      kind: candidate.kind,
      detail: candidate.detail,
      sortText: declarationKeywordSortText(candidate),
      filterText: candidate.label,
      ...(clientSupportsSnippets ? { insertTextFormat: InsertTextFormat.Snippet } : {}),
      textEdit: {
        range: replacementRange,
        newText: clientSupportsSnippets ? candidate.snippetText : candidate.insertText,
      },
    }));
}

function declarationKeywordCandidates(
  scope: DeclarationKeywordCompletionContext['scope'],
  source: PslCompletionCandidateSource,
): readonly DeclarationKeywordCompletionCandidate[] {
  const nativeCandidates =
    scope === 'namespace' ? namespaceNativeDeclarationKeywords : documentNativeDeclarationKeywords;
  return [
    ...nativeCandidates,
    ...genericBlockDeclarationKeywordCandidates(source.pslBlockDescriptors),
  ];
}

function nativeDeclarationKeyword(
  label: string,
  insertText: string,
  snippetText: string,
): DeclarationKeywordCompletionCandidate {
  return {
    category: 'native',
    label,
    insertText,
    snippetText,
    detail: 'PSL declaration keyword',
    kind: CompletionItemKind.Keyword,
  };
}

function genericBlockDeclarationKeywordCandidates(
  descriptors: AuthoringPslBlockDescriptorNamespace,
): readonly DeclarationKeywordCompletionCandidate[] {
  return descriptorBlockKeywords(descriptors).map((keyword) => ({
    category: 'genericBlock',
    label: keyword,
    insertText: `${keyword} `,
    snippetText: `${keyword} ${nameSnippetPlaceholder} {\n  $0\n}`,
    detail: 'Generic block keyword',
    kind: CompletionItemKind.Keyword,
  }));
}

function descriptorBlockKeywords(
  descriptors: AuthoringPslBlockDescriptorNamespace,
): readonly string[] {
  const keywords: string[] = [];
  collectDescriptorBlockKeywords(descriptors, keywords);
  return sortedUnique(keywords);
}

function collectDescriptorBlockKeywords(
  descriptors: AuthoringPslBlockDescriptorNamespace,
  keywords: string[],
): void {
  for (const value of Object.values(descriptors)) {
    if (isAuthoringPslBlockDescriptor(value)) {
      keywords.push(value.keyword);
      continue;
    }
    collectDescriptorBlockKeywords(value, keywords);
  }
}

function declarationKeywordSortText(candidate: DeclarationKeywordCompletionCandidate): string {
  return `${declarationKeywordCategoryOrder[candidate.category]}:${candidate.label}`;
}

function provideGenericBlockParameterCompletionItems(
  context: GenericBlockParameterCompletionContext,
  sourceFile: SourceFile,
  source: PslCompletionCandidateSource,
): readonly CompletionItem[] {
  const descriptor = findBlockDescriptor(source.pslBlockDescriptors, context.blockKeyword);
  if (descriptor === undefined) {
    return [];
  }

  const existing = new Set(context.existingParameterNames);
  const replacementRange = {
    start: sourceFile.positionAt(context.replacementStartOffset),
    end: sourceFile.positionAt(context.offset),
  };

  return Object.keys(descriptor.parameters)
    .filter((parameterName) => !existing.has(parameterName))
    .filter((parameterName) => parameterName.startsWith(context.prefix))
    .map((parameterName, index) => ({
      label: parameterName,
      kind: CompletionItemKind.Property,
      detail: 'Generic block parameter',
      sortText: genericBlockParameterSortText(index, parameterName),
      filterText: parameterName,
      textEdit: {
        range: replacementRange,
        newText: parameterName,
      },
    }));
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
    .map(namespaceQualifierCandidate);
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

function namespaceQualifierCandidate(namespace: NamespaceSymbol): ModelTypeCompletionCandidate {
  const qualifier = `${namespace.name}.`;
  return {
    category: 'namespace',
    label: qualifier,
    insertText: qualifier,
    filterText: qualifier,
    detail: 'Namespace',
    kind: CompletionItemKind.Module,
  };
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

function genericBlockParameterSortText(index: number, label: string): string {
  return `${index.toString().padStart(4, '0')}:${label}`;
}

function compareNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
