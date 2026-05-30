import type { PreserveEmptyPredicate } from '@prisma-next/contract/hashing';
import {
  createPreserveEmptyPredicate,
  type PathPattern,
} from '@prisma-next/contract/hashing-utils';

const preserveEmptyPatterns = [
  ['storage', '*', 'collections'],
  ['storage', '*', 'collections', '*'],
] as const satisfies readonly PathPattern[];

const shouldPreserveEmpty: PreserveEmptyPredicate =
  createPreserveEmptyPredicate(preserveEmptyPatterns);

export const mongoContractCanonicalizationHooks: {
  readonly shouldPreserveEmpty: PreserveEmptyPredicate;
} = {
  shouldPreserveEmpty,
};
