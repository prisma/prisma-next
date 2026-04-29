/**
 * Single source of truth for the pgvector `pg/vector@1` codec.
 *
 * Pre-Phase-1, the codec definition was split across five files
 * (`constants.ts`, `codecs.ts`, `vector-factory.ts`, `authoring.ts`,
 * `descriptor-meta.ts`) and `encodeVector` / `decodeVector` were duplicated
 * between the legacy `codec(...)` declaration and the higher-order factory.
 * This module consolidates everything codec-shaped: constants, encode/decode,
 * the curried factory, the column-author surface (`vector(N)`, `vectorColumn`),
 * and the framework-registration descriptor (`pgVectorCodec`). Length
 * validation is shared between the column-author throw path and the
 * descriptor's `paramsSchema.narrow(...)`. See [ADR 205](../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import type {
  Codec,
  Ctx,
  ParameterizedCodecDescriptor,
} from '@prisma-next/framework-components/codec';
import { type as arktype } from 'arktype';
import type { Vector } from '../types/codec-types';

// ── Constants ────────────────────────────────────────────────────────────

/** Codec id for pgvector's vector type. */
export const VECTOR_CODEC_ID = 'pg/vector@1' as const;

/** Maximum dimension supported by pgvector (matches upstream `VECTOR_MAX_DIM`). */
export const VECTOR_MAX_DIM = 16000;

// ── Length validation (single source of truth) ───────────────────────────

/**
 * Validate that `length` is a positive integer in `[1, VECTOR_MAX_DIM]`.
 * Returns `null` on success; returns an error message otherwise. Used by both
 * `vector(N)` (which throws a `RangeError`) and `pgVectorCodec.paramsSchema`
 * (which surfaces via the Standard-Schema `narrow` API). Sharing the predicate
 * keeps the two surfaces from drifting in their bound checks.
 */
function checkVectorLength(length: number): string | null {
  if (!Number.isInteger(length)) {
    return 'an integer';
  }
  if (length < 1 || length > VECTOR_MAX_DIM) {
    return `in the range [1, ${VECTOR_MAX_DIM}]`;
  }
  return null;
}

// ── Wire format encode/decode (single source of truth) ───────────────────

function encodeVector(value: number[]): string {
  if (!Array.isArray(value)) {
    throw new Error('Vector value must be an array of numbers');
  }
  if (!value.every((v) => typeof v === 'number')) {
    throw new Error('Vector value must contain only numbers');
  }
  // PostgreSQL vector text format: `[1,2,3]`. The pg driver requires the
  // bracket-comma form on the wire; we don't accept any other shape.
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

// ── Curried higher-order codec factory ───────────────────────────────────

/** Codec instance returned by `vectorCodecForLength(N)(ctx)`. */
export type VectorCodec<N extends number = number> = Codec<
  typeof VECTOR_CODEC_ID,
  readonly ['equality'],
  string,
  Vector<N>
>;

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

// ── Column-author surfaces ───────────────────────────────────────────────

/**
 * Static vector column descriptor without dimension. Carried for back-compat
 * with consumers that don't need a typed length; users that want the typed
 * `Vector<N>` resolution should use `vector(N)`.
 */
export const vectorColumn = {
  codecId: VECTOR_CODEC_ID,
  nativeType: 'vector',
} as const satisfies ColumnTypeDescriptor;

/**
 * Curried higher-order codec factory for dimensioned vectors. Same call site
 * as the pre-M4 helper (`vector(1536)`); the return type carries the higher-
 * order codec factory in `type` so the no-emit `FieldOutputType` resolver
 * picks up the resolved JS type as `Vector<N>`.
 *
 * @param length - The dimension of the vector (e.g., 1536 for OpenAI embeddings)
 * @returns A column type descriptor with `typeParams.length` set and a `type`
 *          factory keyed by `length`
 * @throws {RangeError} If length is not an integer in the range [1, VECTOR_MAX_DIM]
 */
export function vector<N extends number>(
  length: N,
): ColumnTypeDescriptor & {
  readonly codecId: typeof VECTOR_CODEC_ID;
  readonly nativeType: 'vector';
  readonly typeParams: { readonly length: N };
  readonly type: (ctx: Ctx) => VectorCodec<N>;
} {
  if (checkVectorLength(length) !== null) {
    throw new RangeError(
      `pgvector: dimension must be an integer in [1, ${VECTOR_MAX_DIM}], got ${length}`,
    );
  }
  return {
    codecId: VECTOR_CODEC_ID,
    nativeType: 'vector',
    typeParams: { length },
    type: vectorCodecForLength(length),
  } as const;
}

// ── Framework-registration descriptor ────────────────────────────────────

const vectorParamsSchema = arktype({
  length: 'number',
}).narrow((params, ctx) => {
  // Surface the same validation the column-author throw uses, via the
  // Standard-Schema-compatible `narrow` callback. The two surfaces share
  // `checkVectorLength` so they can never disagree.
  const error = checkVectorLength(params.length);
  if (error !== null) {
    return ctx.mustBe(error);
  }
  return true;
});

/**
 * Framework-registration descriptor for the pgvector codec. Registered through
 * the SQL runtime's `parameterizedCodecs` slot; `sql-runtime`'s
 * `initializeTypeHelpers` calls `pgVectorCodec.factory(typeParams)(ctx)` once
 * per `storage.types` instance keyed by `pg/vector@1` to materialize the
 * resolved codec.
 */
export const pgVectorCodec: ParameterizedCodecDescriptor<{ readonly length: number }> = {
  codecId: VECTOR_CODEC_ID,
  traits: ['equality'] as const,
  targetTypes: ['vector'] as const,
  paramsSchema: vectorParamsSchema,
  renderOutputType: ({ length }) => `Vector<${length}>`,
  factory: ({ length }) => vectorCodecForLength(length),
};

// ── Pack-meta-time codec instance ────────────────────────────────────────

/**
 * Synthetic context used to materialize a representative codec instance at
 * pack-meta load time. The pack-meta consumer (`extractCodecLookup`) only
 * reads `id`, `targetTypes`, and `meta` off the codec, none of which depend
 * on `length` or `ctx` (pgvector is stateless per-instance and length-agnostic
 * at the wire level). Materializing once with `length: 1` is therefore
 * representative for every dimension the user authors.
 */
const packMetaSyntheticCtx: Ctx = {
  name: '<pgvector-pack-meta>',
  usedAt: [],
};

/**
 * Representative codec instance for the `codecInstances` array on
 * `pgvectorPackMeta.types.codecTypes`. Sourced from the same factory the
 * runtime uses; any dimension produces a structurally identical codec, so
 * the framework's codec lookup gets exactly the same `id`/`targetTypes`/`meta`
 * shape it consumed pre-Phase-1 from the legacy `codec(...)` declaration.
 *
 * Annotated as the framework-base `Codec` (rather than the factory's inferred
 * `VectorCodec<1>`) so downstream consumers that transitively infer a contract
 * type through this constant don't surface TS portability warnings tracing
 * back to a private chunk of this module's dist output. The codec lookup never
 * reads the `Js` brand parameter; widening here is a no-op at the consumer.
 */
export const pgVectorRepresentativeCodec: Codec = vectorCodecForLength(1)(packMetaSyntheticCtx);
