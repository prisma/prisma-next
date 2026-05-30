import {
  createPreserveEmptyPredicate,
  createStorageSort,
  type NamedArraySortTarget,
  type PathPattern,
} from '@prisma-next/contract/hashing-utils';

const preserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'tables'],
  ['storage', 'namespaces', '*', 'tables', '*'],
  ['storage', 'namespaces', '*', 'tables', '*', ['uniques', 'indexes', 'foreignKeys']],
  ['storage', 'namespaces', '*', 'tables', '*', 'foreignKeys', ['constraint', 'index']],
  ['storage', 'types', '*', 'typeParams'],
] as const satisfies readonly PathPattern[];

const sortTargets = [
  { path: ['namespaces', '*', 'tables', '*'], arrayKeys: ['indexes', 'uniques'] },
] as const satisfies readonly NamedArraySortTarget[];

const shouldPreserveEmpty = createPreserveEmptyPredicate(preserveEmptyPatterns);

const sortStorage = createStorageSort(sortTargets);

export const sqlContractCanonicalizationHooks = {
  shouldPreserveEmpty,
  sortStorage,
} as const;
