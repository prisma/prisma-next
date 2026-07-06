/**
 * SQL-family extension to the framework codec lookup: a per-instance native type for a
 * parameterized codec (e.g. a native enum's Postgres type name from its `typeParams`).
 *
 * `StorageColumn.nativeType` already lives in this package — it is the SQL-layer concept
 * `nativeType` names. The framework `CodecDescriptor`/`CodecLookup` stay family-agnostic;
 * this hook and its wiring live here instead.
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
