/**
 * Curried higher-order codec factory for the pgvector `pg/vector@1` codec.
 *
 * Single source of truth for both:
 * - The column-author surface in `../exports/column-types.ts`
 *   (`vector(N)` returns a `ColumnTypeDescriptor` whose `type` slot is the
 *   curried factory).
 * - The framework-registration descriptor in `../exports/codecs.ts`
 *   (`pgVectorCodec.factory` unwraps `params.length` and delegates here).
 *
 * The factory's TS return signature carries the resolved JS type
 * (`Vector<N>`); M2's no-emit `FieldOutputType` reads the `Js` slot off
 * `Codec<…, Js>` directly. The runtime side calls `factory(params)(ctx)` once
 * per `storage.types` instance via `initializeTypeHelpers` (M1 R2 wiring) to
 * route per-instance state.
 *
 * Codec-model-unification project, M4 T1.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec, Ctx } from '@prisma-next/framework-components/codec';
import type { Vector } from '../types/codec-types';
import { VECTOR_CODEC_ID } from './constants';

/** Codec instance returned by `vectorCodecForLength(N)(ctx)`. */
export type VectorCodec<N extends number = number> = Codec<
  typeof VECTOR_CODEC_ID,
  readonly ['equality'],
  string,
  Vector<N>
>;

function encodeVector(value: number[]): string {
  if (!Array.isArray(value)) {
    throw new Error('Vector value must be an array of numbers');
  }
  if (!value.every((v) => typeof v === 'number')) {
    throw new Error('Vector value must contain only numbers');
  }
  return `[${value.join(',')}]`;
}

function decodeVector(wire: string): number[] {
  if (typeof wire !== 'string') {
    throw new Error('Vector wire value must be a string');
  }
  if (!wire.startsWith('[') || !wire.endsWith(']')) {
    throw new Error(`Invalid vector format: expected "[...]", got "${wire}"`);
  }
  const content = wire.slice(1, -1).trim();
  if (content === '') {
    return [];
  }
  return content.split(',').map((v) => {
    const num = Number.parseFloat(v.trim());
    if (Number.isNaN(num)) {
      throw new Error(`Invalid vector value: "${v}" is not a number`);
    }
    return num;
  });
}

/**
 * Build the curried factory `(ctx) => Codec<…, Vector<N>>` for a fixed length.
 *
 * Stateless w.r.t. `ctx` and `length` at runtime — pgvector's runtime
 * materialization needs no per-column state, and the wire format is the same
 * regardless of dimension. The closure exists to satisfy the higher-order
 * shape and to give the no-emit type resolver a `(ctx) => Codec<…, Vector<N>>`
 * to read.
 */
export function vectorCodecForLength<N extends number>(_length: N): (ctx: Ctx) => VectorCodec<N> {
  return (_ctx: Ctx) => ({
    id: VECTOR_CODEC_ID,
    targetTypes: ['vector'] as const,
    traits: ['equality'] as const,
    encode: encodeVector,
    // `decode` returns `number[]`; `Vector<N>` is structurally a `number[]`
    // with an optional phantom brand, so the runtime value satisfies the type
    // — only the brand needs the cast for the type system to accept it.
    decode: decodeVector as (wire: string) => Vector<N>,
    // JSON wire-side is structurally identical to the JS-side (vectors are
    // `number[]`s, which are JSON-safe by definition); the cast threads the
    // `Vector<N>` brand through the JSON-typed surface.
    encodeJson: (value: Vector<N>) => value as unknown as JsonValue,
    decodeJson: (json: JsonValue) => json as unknown as Vector<N>,
    meta: {
      db: {
        sql: {
          postgres: {
            nativeType: 'vector',
          },
        },
      },
    },
  });
}
