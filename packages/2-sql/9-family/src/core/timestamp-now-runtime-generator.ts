import { TIMESTAMP_NOW_GENERATOR_ID } from '@prisma-next/framework-components/control';
import type { RuntimeMutationDefaultGenerator } from '@prisma-next/sql-runtime';

/**
 * Builds the canonical runtime-plane generator for the wall-clock-now
 * mutation default. Returns `new Date()`; semantics are target-agnostic
 * so all SQL targets share this single implementation.
 *
 * Marked `stableAcrossRows: true` so a single ORM bulk operation
 * (e.g. `createAll([...])`) reuses one timestamp across every row that
 * needs the default. This matches Prisma 6's `@updatedAt` semantics:
 * one `new Date()` per lowered mutation, not per row.
 *
 * Lives in a runtime-plane-only module so the control-plane
 * `timestamp-now-generator.ts` (descriptor + authoring presets) stays
 * free of `@prisma-next/sql-runtime` imports.
 */
export function timestampNowRuntimeGenerator(): RuntimeMutationDefaultGenerator {
  return {
    id: TIMESTAMP_NOW_GENERATOR_ID,
    generate: () => new Date(),
    stableAcrossRows: true,
  };
}
