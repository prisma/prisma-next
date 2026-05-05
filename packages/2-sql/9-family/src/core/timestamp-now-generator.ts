import {
  type MutationDefaultGeneratorDescriptor,
  TIMESTAMP_NOW_GENERATOR_ID,
} from '@prisma-next/framework-components/control';
import type { RuntimeMutationDefaultGenerator } from '@prisma-next/sql-runtime';

/**
 * Builds the canonical control-plane descriptor for the wall-clock-now
 * mutation default generator. Targets contribute only their applicable
 * codec ids; the descriptor's `id`, `buildPhases`, and any future shared
 * behavior live here so PSL `@updatedAt` and TS `field.updatedAt()`
 * lower to byte-identical contracts across targets.
 */
export function timestampNowControlDescriptor(
  applicableCodecIds: readonly string[],
): MutationDefaultGeneratorDescriptor {
  return {
    id: TIMESTAMP_NOW_GENERATOR_ID,
    applicableCodecIds,
    buildPhases: () => ({
      onCreate: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID },
      onUpdate: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID },
    }),
  };
}

/**
 * Builds the canonical runtime-plane generator for the wall-clock-now
 * mutation default. Returns `new Date()`; semantics are target-agnostic
 * so all SQL targets share this single implementation.
 *
 * Marked `stableAcrossRows: true` so a single ORM bulk operation
 * (e.g. `createAll([...])`) reuses one timestamp across every row that
 * needs the default. This matches Prisma 6's `@updatedAt` semantics:
 * one `new Date()` per lowered mutation, not per row.
 */
export function timestampNowRuntimeGenerator(): RuntimeMutationDefaultGenerator {
  return {
    id: TIMESTAMP_NOW_GENERATOR_ID,
    generate: () => new Date(),
    stableAcrossRows: true,
  };
}
