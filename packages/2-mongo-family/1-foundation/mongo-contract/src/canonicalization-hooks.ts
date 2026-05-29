import type { PreserveEmptyPredicate } from '@prisma-next/contract/hashing';

const shouldPreserveEmpty: PreserveEmptyPredicate = (path) => {
  const len = path.length;
  if (len < 2 || path[0] !== 'storage' || path[1] !== 'namespaces') return false;
  if (len === 4 && path[3] === 'collections') return true;
  if (len === 5 && path[3] === 'collections') return true;
  return false;
};

export const mongoContractCanonicalizationHooks = {
  shouldPreserveEmpty,
} as const;
