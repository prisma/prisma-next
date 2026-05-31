import { crossRef } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';

export { crossRef, UNBOUND_NAMESPACE_ID };

export function documentScopedTypes(contract: { readonly storage?: unknown }) {
  return (contract.storage as { readonly types?: Record<string, unknown> } | undefined)?.types;
}
