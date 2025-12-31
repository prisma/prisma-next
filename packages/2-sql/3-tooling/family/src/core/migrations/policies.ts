import type { MigrationOperationPolicy } from '@prisma-next/core-control-plane/types';

/**
 * Policy used by `db init`: additive-only operations, no widening/destructive steps.
 */
export const INIT_ADDITIVE_POLICY: MigrationOperationPolicy = Object.freeze({
  allowedOperationClasses: Object.freeze(['additive'] as const),
});
