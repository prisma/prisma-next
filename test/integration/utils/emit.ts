import type { Contract } from '@prisma-next/contract/types';
import { emit as emitImpl } from '@prisma-next/emitter';
import type { EmissionSpi } from '@prisma-next/framework-components/emission';
import type { JsonObject } from '@prisma-next/utils/json';

/**
 * Tests author JSON-clean contracts directly, so the canonicalisation
 * hook trivially passes through. Production callers thread the target
 * descriptor's `contractSerializer.serializeContract` instead.
 */
export function emit(
  contract: Contract,
  stack: Parameters<typeof emitImpl>[1],
  family: EmissionSpi,
  options: Partial<Parameters<typeof emitImpl>[3]> = {},
): ReturnType<typeof emitImpl> {
  return emitImpl(contract, stack, family, {
    serializeContract: (c) => c as unknown as JsonObject,
    ...options,
  });
}
