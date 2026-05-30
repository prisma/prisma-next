import {
  createPreserveEmptyPredicate,
  type PathPattern,
} from '@prisma-next/contract/hashing-utils';

const preserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'collections'],
  ['storage', 'namespaces', '*', 'collections', '*'],
] as const satisfies readonly PathPattern[];

const shouldPreserveEmpty = createPreserveEmptyPredicate(preserveEmptyPatterns);

export const mongoContractCanonicalizationHooks = {
  shouldPreserveEmpty,
} as const;
