import type { AuthoringFieldPresetDescriptor } from '@prisma-next/framework-components/authoring';
import type { MutationDefaultGeneratorDescriptor } from '@prisma-next/framework-components/control';

/**
 * Canonical id for the wall-clock-now mutation default generator.
 *
 * Owned by `family-sql` because that's where the generator lives. The
 * id flows out from here to (1) the control-plane descriptor and the
 * temporal field-preset pair below, (2) the runtime-plane sibling
 * `timestamp-now-runtime-generator.ts`, and (3) authoring surfaces
 * (PSL `temporal.updatedAt()`, TS `field.temporal.updatedAt()`) via
 * the descriptor flow. Co-locating the constant with its only owner
 * keeps the framework layer free of concrete generator ids.
 */
export const TIMESTAMP_NOW_GENERATOR_ID = 'timestampNow' as const;

/**
 * Builds the canonical control-plane descriptor for the wall-clock-now
 * mutation default generator. The descriptor's `id` and `buildPhases`
 * are target-agnostic so PSL `temporal.updatedAt()` and TS
 * `field.temporal.updatedAt()` lower to byte-identical contracts.
 *
 * `applicableCodecIds` is omitted: `timestampNow` is preset-only (not
 * reachable via `@default(timestampNow())` lowering), and the codec is
 * co-registered by the preset descriptor itself, so the
 * `@default(...)` compatibility check has no role to play here.
 */
export function timestampNowControlDescriptor(): MutationDefaultGeneratorDescriptor {
  return {
    id: TIMESTAMP_NOW_GENERATOR_ID,
    buildPhases: () => ({
      onCreate: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID },
      onUpdate: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID },
    }),
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
/* @__NO_SIDE_EFFECTS__ */
export function temporalAuthoringPresets<
  const CodecId extends string,
  const NativeType extends string,
>(input: { readonly codecId: CodecId; readonly nativeType: NativeType }) {
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
  } as const satisfies Record<string, AuthoringFieldPresetDescriptor>;
}
