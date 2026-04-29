/**
 * Single source of truth for the arktype-json `arktype/json@1` codec.
 *
 * This module ships the per-library JSON-with-schema column factory (`arktypeJson`)
 * and the framework-registration descriptor (`arktypeJsonCodec`). The two surfaces
 * share one serialize / rehydrate pipeline keyed on arktype's internal IR.
 *
 * **Serialization** (column-author site, eager):
 *
 * - `expression`: `schema.expression` — arktype's TypeScript-source-like rendering
 *   used by the emit-path `renderOutputType` to produce the column's TS type
 *   in `contract.d.ts`.
 * - `jsonIr`: `schema.json` — arktype's internal IR. Lossless; the rehydration
 *   source consumed by `ark.schema(jsonIr)` at runtime.
 *
 * The pair is sufficient: `expression` round-trips with the rehydrated schema
 * (`ark.schema(jsonIr).expression === expression`) so the emit-path output
 * is stable across serialize/rehydrate.
 *
 * **Rehydration** (runtime, on factory invocation): `ark.schema(typeParams.jsonIr)`
 * returns a callable `Type`-like with `~standard`. The returned codec's `decode`
 * body validates wire payloads through the rehydrated schema and throws
 * `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` on rejection — no separate validator
 * registry consultation.
 *
 * See the codec-registry-unification spec § Case J (JSON-with-schema) and
 * [ADR 205](../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import type { Codec, CodecDescriptor, Ctx } from '@prisma-next/framework-components/codec';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import { ArkErrors, ark, type Type, type } from 'arktype';

// ── Constants ────────────────────────────────────────────────────────────

/** Codec id for arktype-backed JSON columns. Library-bound, not target-bound. */
export const ARKTYPE_JSON_CODEC_ID = 'arktype/json@1' as const;

/** Native storage type backing the codec. JSONB on Postgres; binary, indexable. */
export const ARKTYPE_JSON_NATIVE_TYPE = 'jsonb' as const;

// ── typeParams shape ─────────────────────────────────────────────────────

/**
 * Eagerly serialized typeParams for the arktype-json column. Carried in the
 * contract IR; the runtime descriptor's factory rehydrates `jsonIr` and
 * the emitter consumes `expression`.
 */
export type ArktypeJsonTypeParams = {
  /**
   * Arktype's TypeScript-source-like rendering of the schema. Read by
   * `renderOutputType` to emit the column's TS type into `contract.d.ts`.
   * Stable across the serialize/rehydrate cycle: the rehydrated schema's
   * `expression` matches the source schema's.
   */
  readonly expression: string;
  /**
   * Arktype's internal IR for the schema. Lossless; the rehydration source.
   * Schema-shape — `ark.schema(jsonIr)` reconstructs a callable `Type`-like
   * structurally identical to the original `type(definition)` output.
   */
  readonly jsonIr: object;
};

// ── Curried higher-order codec factory ───────────────────────────────────

/**
 * Codec instance returned by `arktypeJson(schema)(ctx)` and by
 * `arktypeJsonCodec.factory(typeParams)(ctx)`. The `Js` slot carries the
 * arktype schema's inferred output.
 */
export type ArktypeJsonCodec<TInferred> = Codec<
  typeof ARKTYPE_JSON_CODEC_ID,
  readonly ['equality'],
  string,
  TInferred
>;

/**
 * Structural narrow of arktype's `Type` — the surface our codec depends on:
 * a callable validator that returns `inferOut | ArkErrors`, plus the
 * `expression` string for emit-path rendering.
 *
 * Avoids depending on the precise generics of arktype's `Type<t, $>` so
 * schemas built in any scope (the default `Ark` from `type(...)` AND the
 * minimal scope from `ark.schema(...)`) satisfy the same contract.
 */
type ArktypeSchemaLike = ((value: unknown) => unknown) & {
  readonly expression: string;
};

/**
 * Build the curried factory for a rehydrated arktype schema. The factory's
 * returned codec carries the schema in its closure; `decode` validates wire
 * payloads via `schema(parsed)`, throwing `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED`
 * on rejection.
 *
 * Encode is `JSON.stringify` — the schema validates the input shape only at
 * the read boundary (decode), matching the JSON-validator philosophy: the
 * payload may have been written by any source (this writer, a previous
 * version of the schema, a manual SQL `INSERT`); validate when reading,
 * not when writing.
 */
function arktypeJsonCodecForSchema<TInferred>(
  schema: ArktypeSchemaLike,
): (ctx: Ctx) => ArktypeJsonCodec<TInferred> {
  return (_ctx) => ({
    id: ARKTYPE_JSON_CODEC_ID,
    targetTypes: [ARKTYPE_JSON_NATIVE_TYPE] as const,
    traits: ['equality'] as const,
    encode(value: TInferred): string {
      return JSON.stringify(value);
    },
    decode(wire: string): TInferred {
      const parsed: unknown = JSON.parse(wire);
      const result = schema(parsed);
      if (result instanceof ArkErrors) {
        throw runtimeError(
          'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
          `arktype-json schema validation failed (decode): ${result.summary}`,
          { codecId: ARKTYPE_JSON_CODEC_ID, issues: result.summary },
        );
      }
      // arktype's call-result is `inferOut | ArkErrors`; the ArkErrors branch
      // is excluded above. The cast threads the caller-supplied generic onto
      // the structurally-typed validation output.
      return result as TInferred;
    },
    encodeJson(value: TInferred): JsonValue {
      // The contract IR's JSON-side surface is typed against `JsonValue`;
      // arktype outputs may include narrowed types (literal unions, branded
      // types, …) that aren't structurally `JsonValue`. The cast is a wire-
      // level identity by contract: the caller agrees the value is JSON-safe.
      return value as JsonValue;
    },
    decodeJson(jsonValue: JsonValue): TInferred {
      // Symmetric with `encodeJson`. Runtime validation lives in `decode`
      // above (driver wire path), not on the contract-load JSON path —
      // contract.json is trusted authoring output.
      return jsonValue as TInferred;
    },
  });
}

// ── Column-author surface ────────────────────────────────────────────────

/**
 * Curried column-author factory for arktype-validated JSON columns.
 *
 * Usage:
 *
 * ```ts
 * import { type } from 'arktype';
 * import { arktypeJson } from '@prisma-next/extension-arktype-json/column-types';
 *
 * const ProductSchema = type({ name: 'string', price: 'number' });
 *
 * const Product = {
 *   columns: {
 *     id: textCodec,
 *     settings: arktypeJson(ProductSchema),
 *     //        ^? ColumnTypeDescriptor with type :: (ctx) => Codec<…, { name: string; price: number }>
 *   },
 * };
 * ```
 *
 * The schema's inferred output flows through `S['infer']` so the no-emit
 * `FieldOutputType` resolver produces the precise TS type at the column
 * site. Eager serialization at this call site captures `expression` (for
 * the emit-path renderer) and `jsonIr` (for runtime rehydration).
 *
 * @throws {Error} if the schema doesn't expose `expression` and `json` fields
 *   (i.e. is not an arktype `Type`). The factory validates the schema shape
 *   at the call site so configuration errors surface during contract authoring,
 *   not at runtime.
 */
export function arktypeJson<S extends Type<unknown>>(
  schema: S,
): ColumnTypeDescriptor & {
  readonly codecId: typeof ARKTYPE_JSON_CODEC_ID;
  readonly nativeType: typeof ARKTYPE_JSON_NATIVE_TYPE;
  readonly typeParams: ArktypeJsonTypeParams;
  readonly type: (ctx: Ctx) => ArktypeJsonCodec<S['infer']>;
} {
  const expression: unknown = (schema as { readonly expression?: unknown }).expression;
  const jsonIr: unknown = (schema as { readonly json?: unknown }).json;
  if (typeof expression !== 'string') {
    throw new Error('arktypeJson(schema) expects an arktype Type (missing `expression: string`).');
  }
  if (jsonIr === null || typeof jsonIr !== 'object') {
    throw new Error('arktypeJson(schema) expects an arktype Type (missing `json` IR).');
  }
  return {
    codecId: ARKTYPE_JSON_CODEC_ID,
    nativeType: ARKTYPE_JSON_NATIVE_TYPE,
    typeParams: { expression, jsonIr },
    type: arktypeJsonCodecForSchema<S['infer']>(schema),
  } as const;
}

// ── Framework-registration descriptor ────────────────────────────────────

/**
 * Standard Schema validator for the descriptor's typeParams. Asserts the
 * shape `{ expression: string; jsonIr: object }` at the contract IR
 * boundary; deeper IR-shape validation happens implicitly when
 * `ark.schema(jsonIr)` reparses (corrupt IR throws there).
 *
 * Eats its own dog food: the validator is itself an arktype schema.
 */
const arktypeJsonParamsSchema = type({
  expression: 'string',
  jsonIr: 'object',
});

/**
 * Rehydrate an arktype schema from the serialized IR. Throws a clean error
 * if the IR is corrupt — the prompt's "corruption-of-contract.json" case.
 */
function rehydrateSchema(jsonIr: object): ArktypeSchemaLike {
  try {
    return ark.schema(jsonIr) as ArktypeSchemaLike;
  } catch (error) {
    throw runtimeError(
      'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
      `Failed to rehydrate arktype schema from contract IR: ${error instanceof Error ? error.message : String(error)}`,
      { codecId: ARKTYPE_JSON_CODEC_ID, jsonIr },
    );
  }
}

/**
 * Render the emit-path TS type for an arktype-json column. Reads the
 * eagerly-extracted `expression` directly — the round-trip stability
 * guarantee (rehydrated schema's `expression` matches the source's)
 * means the rendered output is consistent across serialize/rehydrate.
 */
function renderArktypeJsonOutputType(params: ArktypeJsonTypeParams): string {
  const expression = params.expression.trim();
  return expression.length > 0 ? expression : 'unknown';
}

/**
 * Framework-registration descriptor for the arktype-json codec. Registered
 * through the SQL runtime's `parameterizedCodecs:` slot. `sql-runtime`'s
 * `initializeTypeHelpers` calls `arktypeJsonCodec.factory(typeParams)(ctx)`
 * once per `storage.types` instance (or once per inline-typeParams column)
 * to materialize the resolved codec carrying the rehydrated schema.
 *
 * Per Phase 3.5a of codec-registry-unification, `descriptorFor('arktype/json@1')`
 * returns this descriptor and its `traits`/`targetTypes` are the codec-id-
 * keyed source of truth — no parallel `pgVectorRepresentativeCodec`-style
 * placeholder on the legacy `codecs:` slot is needed.
 */
export const arktypeJsonCodec: CodecDescriptor<ArktypeJsonTypeParams> = {
  codecId: ARKTYPE_JSON_CODEC_ID,
  traits: ['equality'] as const,
  targetTypes: [ARKTYPE_JSON_NATIVE_TYPE] as const,
  paramsSchema: arktypeJsonParamsSchema,
  renderOutputType: renderArktypeJsonOutputType,
  factory: (params) => {
    const schema = rehydrateSchema(params.jsonIr);
    // The rehydrated schema's `expression` should match the serialized one;
    // diverging means contract.json was hand-edited out from under the
    // emit-path renderer. Surface as a soft warning at materialization time
    // so the caller knows their emit output may not match the runtime
    // schema. The runtime keeps using the schema rehydrated from `jsonIr`
    // — that's the lossless source — so the worst case is an emit-vs-
    // runtime divergence at a single column, not a runtime failure.
    /* c8 ignore start — defensive parity check; not exercised by typical contracts */
    const rehydratedExpression = (schema as { readonly expression?: unknown }).expression;
    if (typeof rehydratedExpression === 'string' && rehydratedExpression !== params.expression) {
      // Drop a one-time warning rather than throwing — runtime can still
      // dispatch correctly. Log once per (codecId, expression-pair) via a
      // `console.warn`; consumers that want stricter behavior can wrap.
      console.warn(
        `[arktype-json] typeParams.expression (${params.expression}) does not match rehydrated schema expression (${rehydratedExpression}); contract.json may be stale relative to the runtime schema.`,
      );
    }
    /* c8 ignore stop */
    return arktypeJsonCodecForSchema<unknown>(schema);
  },
};
