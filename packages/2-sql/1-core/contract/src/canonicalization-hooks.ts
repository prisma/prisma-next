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
  // A column default's literal payload is data, not shape — `{ kind:
  // 'literal', value: false }` (or `value: []`) must survive the
  // default-omission walk or the emitted contract fails its own
  // validation on the next read (PN-CLI-4003 on `Boolean @default(false)`).
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'columns', '*', 'default', 'value'],
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
