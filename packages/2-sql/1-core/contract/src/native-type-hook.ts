/**
 * SQL-family codec-descriptor hooks: a per-instance native type for a parameterized codec (e.g. a
 * native enum's Postgres type name from its `typeParams`), and a marker for a codec whose storage
 * type intrinsically enforces its value-set (so the family-shared column builder skips
 * auto-generating a `CHECK`).
 *
 * `StorageColumn.nativeType` and `CHECK` constraints already live in this package — they are
 * SQL-layer concepts. The framework `CodecDescriptor`/`CodecLookup` stay family-agnostic; these
 * hooks and their wiring live here instead.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';

/**
 * Structural shape a codec descriptor may implement to expose a per-instance native type.
 * `undefined` (or a missing hook) means the codec has no per-instance native type and
 * renderers fall back to the codec's static meta.
 */
export interface NativeTypeForCodecDescriptor {
  readonly nativeTypeFor: (typeParams: JsonValue | undefined) => string | undefined;
}

/** Structural check for {@link NativeTypeForCodecDescriptor}: no casts. */
export function providesNativeTypeFor(
  descriptor: unknown,
): descriptor is NativeTypeForCodecDescriptor {
  if (typeof descriptor !== 'object' || descriptor === null || !('nativeTypeFor' in descriptor)) {
    return false;
  }
  const { nativeTypeFor } = descriptor;
  return typeof nativeTypeFor === 'function';
}

/**
 * A framework {@link CodecLookup} widened with the SQL-family native-type delegate.
 * `renderTypedParam` (Postgres adapter) reads this to prefer a codec instance's
 * per-instance native type (e.g. a native enum's qualified type name) over the codec's
 * static meta.
 */
export interface SqlCodecLookup extends CodecLookup {
  readonly nativeTypeFor?: (
    codecId: string,
    typeParams: JsonValue | undefined,
  ) => string | undefined;
}

/**
 * Minimal descriptor shape {@link attachNativeTypeFor} needs to find `nativeTypeFor` hooks:
 * a codec id plus whatever the descriptor otherwise carries.
 */
export interface CodecIdentifiedDescriptor {
  readonly codecId: string;
}

/**
 * Structural shape a codec descriptor may implement to mark that its storage type intrinsically
 * enforces its value-set — the family-shared column builder (`contract-ts`'s `build-contract.ts`)
 * writes no `CHECK` constraint for a column whose codec declares this. Explicit rather than
 * inferred from {@link NativeTypeForCodecDescriptor}'s presence: "has a per-instance type name"
 * and "that type enforces the value-set" are different facts.
 */
export interface EnforcesValueSetCodecDescriptor {
  readonly enforcesValueSet: true;
}

/** Structural check for {@link EnforcesValueSetCodecDescriptor}: no casts. */
export function providesEnforcesValueSet(
  descriptor: unknown,
): descriptor is EnforcesValueSetCodecDescriptor {
  if (
    typeof descriptor !== 'object' ||
    descriptor === null ||
    !('enforcesValueSet' in descriptor)
  ) {
    return false;
  }
  return descriptor.enforcesValueSet === true;
}

/**
 * Structural shape a materialized `Codec` instance may carry: a back-reference to the descriptor
 * that built it. `CodecImpl` (the base class every framework codec author extends) declares
 * `descriptor` generically for every family, so {@link codecEnforcesValueSet} reaches a codec's
 * descriptor through the `CodecLookup` authoring code already receives, with no extra
 * descriptor-array plumbing (contrast {@link attachNativeTypeFor}, which needs the raw descriptor
 * array because the SQL renderer consults `nativeTypeFor` before any `Codec` instance is
 * materialized).
 */
interface CodecWithDescriptor {
  readonly descriptor: unknown;
}

function hasDescriptor(value: object): value is CodecWithDescriptor {
  return 'descriptor' in value;
}

/**
 * True when the codec identified by `codecId` enforces its value-set intrinsically (see
 * {@link EnforcesValueSetCodecDescriptor}). `build-contract`'s CHECK-generation consults this so a
 * value-set column whose codec enforces its value-set gets no auto-generated `CHECK`.
 */
export function codecEnforcesValueSet(lookup: CodecLookup | undefined, codecId: string): boolean {
  const codec = lookup?.get(codecId);
  if (codec === undefined) return false;
  if (!hasDescriptor(codec)) return false;
  return providesEnforcesValueSet(codec.descriptor);
}

/**
 * Widen a framework {@link CodecLookup} into an {@link SqlCodecLookup} by probing the given
 * descriptors once for a {@link NativeTypeForCodecDescriptor} hook and closing over a
 * `codecId -> hook` map.
 *
 * Delegates to `lookup` for every other member instead of spreading it: `extractCodecLookup`
 * returns an object literal of closures with no `this`-bound state, so both spreading and
 * delegating are safe here, but delegation keeps this function correct even if a future
 * `CodecLookup` implementation relies on method-level `this`.
 */
export function attachNativeTypeFor(
  lookup: CodecLookup,
  descriptors: readonly CodecIdentifiedDescriptor[],
): SqlCodecLookup {
  const hooksByCodecId = new Map<string, NativeTypeForCodecDescriptor['nativeTypeFor']>();
  for (const descriptor of descriptors) {
    if (providesNativeTypeFor(descriptor)) {
      hooksByCodecId.set(descriptor.codecId, descriptor.nativeTypeFor);
    }
  }
  const widened: SqlCodecLookup = {
    get: (id) => lookup.get(id),
    targetTypesFor: (id) => lookup.targetTypesFor(id),
    metaFor: (id) => lookup.metaFor(id),
    renderOutputTypeFor: (id, params) => lookup.renderOutputTypeFor(id, params),
    nativeTypeFor: (id, typeParams) => hooksByCodecId.get(id)?.(typeParams),
  };
  const { renderInputTypeFor, renderValueLiteralFor } = lookup;
  return {
    ...widened,
    ...(renderInputTypeFor
      ? {
          renderInputTypeFor: (id: string, params: Record<string, unknown>) =>
            renderInputTypeFor(id, params),
        }
      : {}),
    ...(renderValueLiteralFor
      ? {
          renderValueLiteralFor: (id: string, value: JsonValue, side: 'output' | 'input') =>
            renderValueLiteralFor(id, value, side),
        }
      : {}),
  };
}
