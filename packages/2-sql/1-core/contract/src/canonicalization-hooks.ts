import type { PreserveEmptyPredicate, StorageSort } from '@prisma-next/contract/hashing';
import {
  createPreserveEmptyPredicate,
  createStorageSort,
  type NamedArraySortTarget,
  type PathPattern,
} from '@prisma-next/contract/hashing-utils';

const preserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'entries', 'table'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', ['uniques', 'indexes', 'foreignKeys']],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'foreignKeys', ['constraint', 'index']],
  ['storage', 'types', '*', 'typeParams'],
] as const satisfies readonly PathPattern[];

const sortTargets = [
  { path: ['namespaces', '*', 'entries', 'table', '*'], arrayKeys: ['indexes', 'uniques'] },
] as const satisfies readonly NamedArraySortTarget[];

const shouldPreserveEmpty: PreserveEmptyPredicate =
  createPreserveEmptyPredicate(preserveEmptyPatterns);

const sortStorage: StorageSort = createStorageSort(sortTargets);

export const sqlContractCanonicalizationHooks: {
  readonly shouldPreserveEmpty: PreserveEmptyPredicate;
  readonly sortStorage: StorageSort;
} = {
  shouldPreserveEmpty,
  sortStorage,
};
