import type { MigrationPolicy } from './types';

/**
 * Policy used by `db init`: additive-only operations, no widening/destructive steps.
 */
export const INIT_ADDITIVE_POLICY: MigrationPolicy = Object.freeze({
  allowedOperationClasses: Object.freeze(['additive'] as const),
});
