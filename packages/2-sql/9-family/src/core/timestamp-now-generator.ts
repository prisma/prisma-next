import type { AuthoringFieldPresetDescriptor } from '@prisma-next/framework-components/authoring';
import {
  type MutationDefaultGeneratorDescriptor,
  TIMESTAMP_NOW_GENERATOR_ID,
} from '@prisma-next/framework-components/control';
import type { RuntimeMutationDefaultGenerator } from '@prisma-next/sql-runtime';

/**
 * Builds the canonical control-plane descriptor for the wall-clock-now
 * mutation default generator. Targets contribute only their applicable
 * codec ids; the descriptor's `id`, `buildPhases`, and any future shared
 * behavior live here so PSL `temporal.updatedAt()` and TS `field.temporal.updatedAt()`
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

/**
 * Builds the canonical `temporal.{createdAt,updatedAt}` field-preset pair
 * for a SQL target. `createdAt` lowers to a `now()` storage default;
 * `updatedAt` lowers to the `timestampNow` execution generator on both
 * `onCreate` and `onUpdate` (RD: "last modified time", non-null). Targets
 * supply the codec/native-type pair that matches their timestamp column;
 * everything else is shared so PSL `temporal.updatedAt()` and TS
 * `field.temporal.updatedAt()` lower to byte-identical contracts across
 * targets by construction.
 */
export function temporalAuthoringPresets(input: {
  readonly codecId: string;
  readonly nativeType: string;
}): {
  readonly createdAt: AuthoringFieldPresetDescriptor;
  readonly updatedAt: AuthoringFieldPresetDescriptor;
} {
  const { codecId, nativeType } = input;
  return {
    createdAt: {
      kind: 'fieldPreset',
      output: {
        codecId,
        nativeType,
        default: { kind: 'function', expression: 'now()' },
      },
    },
    updatedAt: {
      kind: 'fieldPreset',
      output: {
        codecId,
        nativeType,
        executionDefaults: {
          onCreate: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID },
          onUpdate: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID },
        },
      },
    },
  };
}
