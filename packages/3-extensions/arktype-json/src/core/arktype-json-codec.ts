/**
 * Single source of truth for the arktype-json `arktype/json@1` codec.
 *
 * Ships the per-library JSON-with-schema column factory (`arktypeJson`) and
 * the framework-registration descriptor (`arktypeJsonCodec`). The two
 * surfaces share one serialize/rehydrate pipeline keyed on arktype's
 * internal IR.
 *
 * **Serialization** (column-author site, eager):
 *
 * - `expression`: `schema.expression` — arktype's TypeScript-source-like
 *   rendering used by the emit-path `renderOutputType` to produce the
 *   column's TS type in `contract.d.ts`.
 * - `jsonIr`: `schema.json` — arktype's internal IR. Lossless; the
 *   rehydration source consumed by `ark.schema(jsonIr)` at runtime.
 *
 * The pair is sufficient: `expression` round-trips with the rehydrated
 * schema (`ark.schema(jsonIr).expression === expression`) so the emit-path
 * output is stable across serialize/rehydrate.
 *
 * **Rehydration** (runtime, on factory invocation): `ark.schema(typeParams.jsonIr)`
 * returns a callable `Type`-like with `~standard`. The returned codec's
 * `decode` body validates wire payloads through the rehydrated schema and
 * throws `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` on rejection — no separate
 * validator-registry consultation.
 *
 * See the codec-registry-unification spec § Case J (JSON-with-schema).
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import type {
  Codec,
  CodecDescriptor,
  CodecInstanceContext,
} from '@prisma-next/framework-components/codec';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import { codec } from '@prisma-next/sql-relational-core/ast';
import { ArkErrors, ark, type Type, type } from 'arktype';

// ── Constants ────────────────────────────────────────────────────────────

/** Codec id for arktype-backed JSON columns. Library-bound, not target-bound. */
export const ARKTYPE_JSON_CODEC_ID = 'arktype/json@1' as const;

/** Native storage type backing the codec. JSONB on Postgres; binary, indexable. */
export const ARKTYPE_JSON_NATIVE_TYPE = 'jsonb' as const;

// ── typeParams shape ─────────────────────────────────────────────────────

/**
 * Eagerly serialized typeParams for the arktype-json column. Carried in
 * the contract IR; the runtime descriptor's factory rehydrates `jsonIr`
 * and the emitter consumes `expression`.
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
   * Arktype's internal IR for the schema. Lossless; the rehydration
   * source. Schema-shape — `ark.schema(jsonIr)` reconstructs a callable
   * `Type`-like structurally identical to the original `type(definition)`
   * output.
   */
  readonly jsonIr: object;
};

// ── Curried higher-order codec factory ───────────────────────────────────

/**
 * Codec instance returned by `arktypeJson(schema)(ctx)` and by
 * `arktypeJsonCodec.factory(typeParams)(ctx)`. The `TInferred` slot
 * carries the arktype schema's inferred output type. The wire type is
 * `string | JsonValue` to accommodate Postgres drivers that return
 * `jsonb` cells as already-parsed JS values.
 */
export type ArktypeJsonCodec<TInferred> = Codec<
  typeof ARKTYPE_JSON_CODEC_ID,
  readonly ['equality'],
  string | JsonValue,
  TInferred
>;

/**
 * Structural narrow of arktype's `Type` — the surface our codec depends
 * on: a callable validator that returns `inferOut | ArkErrors`, plus the
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
 * Type predicate for `ArktypeSchemaLike`. Lets the column-author
 * factory narrow `unknown` schemas to the structural shape the codec
 * depends on after the explicit field guards run, so the descriptor
 * builder doesn't fall back to a `as unknown as` cast.
 */
function isArktypeSchemaLike(value: unknown): value is ArktypeSchemaLike {
  if (typeof value !== 'function') return false;
  const expression = (value as { readonly expression?: unknown }).expression;
  return typeof expression === 'string';
}

/**
 * Build the curried factory for a rehydrated arktype schema. The factory's
 * returned codec carries the schema in its closure; `decode` validates
 * wire payloads via `schema(parsed)`, throwing
 * `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` on rejection.
 *
 * Encode is `JSON.stringify` — the schema validates the input shape only
 * at the read boundary (decode), matching the JSON-validator philosophy:
 * the payload may have been written by any source (this writer, a
 * previous version of the schema, a manual SQL `INSERT`); validate when
 * reading, not when writing.
 *
 * Author bodies are sync; main's `codec({...})` factory promise-lifts
 * `encode`/`decode` into the framework-required `Promise<…>` boundary
 * shape (per ADR 204).
 */
function arktypeJsonCodecForSchema<TInferred>(
  schema: ArktypeSchemaLike,
): (ctx: CodecInstanceContext) => ArktypeJsonCodec<TInferred> {
  // Shared schema check used by both `decode` (wire → JS) and
  // `decodeJson` (JsonValue → JS). Either entry point must reject
  // payloads that don't match the schema; without the shared validator,
  // any caller that hands parsed JSON straight to the codec would bypass
  // schema enforcement and return unchecked data.
  function validateSchema(value: unknown): TInferred {
    const result = schema(value);
    if (result instanceof ArkErrors) {
      throw runtimeError(
        'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
        `arktype-json schema validation failed (decode): ${result.summary}`,
        { codecId: ARKTYPE_JSON_CODEC_ID, issues: result.summary },
      );
    }
    // arktype's call-result is `inferOut | ArkErrors`; the ArkErrors
    // branch is excluded above. The cast threads the caller-supplied
    // generic onto the structurally-typed validation output.
    return result as TInferred;
  }

  // Derive both `encode` (wire string) and `encodeJson` (JsonValue)
  // outputs from the same `JSON.stringify` → `JSON.parse` round-trip,
  // then validate the normalized payload through the schema. Without
  // this normalization, a non-JSON-safe runtime value (e.g. a class
  // instance, a function field on a narrowed type) could slip through
  // `encodeJson` unchanged while `encode` silently dropped or
  // transformed it — producing wire payloads the codec's own decode
  // path would later reject. The serialize/parse round-trip also
  // produces the JSON-safe shape required by the contract IR's
  // `JsonValue` surface, so `encodeJson` no longer needs a blind cast.
  function serializeToJsonSafe(value: TInferred): { wire: string; json: JsonValue } {
    // `JSON.stringify` returns `string | undefined` — `undefined`
    // happens when the input is `undefined` itself or contains only
    // unserializable values (functions, symbols). Reject explicitly so
    // the caller sees the schema-failure code rather than a downstream
    // `JSON.parse(undefined)` SyntaxError.
    const wire: string | undefined = JSON.stringify(value);
    if (typeof wire !== 'string') {
      throw runtimeError(
        'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
        `arktype-json value is not representable as JSON (codecId: ${ARKTYPE_JSON_CODEC_ID})`,
        { codecId: ARKTYPE_JSON_CODEC_ID },
      );
    }
    const json = JSON.parse(wire) as JsonValue;
    // Validate the normalized payload — the round-trip strips
    // class-prototype shape and arktype-narrowed fields, and the
    // schema must still accept the result. Run validation and discard
    // its return value (we keep `json` as the JsonValue, not the
    // schema's `inferOut` which already matches `TInferred`).
    validateSchema(json);
    return { wire, json };
  }

  return (_ctx) =>
    codec<typeof ARKTYPE_JSON_CODEC_ID, readonly ['equality'], string | JsonValue, TInferred>({
      typeId: ARKTYPE_JSON_CODEC_ID,
      targetTypes: [ARKTYPE_JSON_NATIVE_TYPE],
      traits: ['equality'] as const,
      encode: (value: TInferred): string => serializeToJsonSafe(value).wire,
      // Postgres `jsonb` columns are returned as already-parsed JS values
      // by some drivers (`pg` does this by default for jsonb) and as raw
      // JSON strings by others. Mirror `pgJsonbCodec`'s `string | JsonValue`
      // tolerance so a select against an arktypeJson column doesn't
      // SyntaxError when the driver hands us a pre-parsed object.
      decode: (wire: string | JsonValue): TInferred =>
        validateSchema(typeof wire === 'string' ? JSON.parse(wire) : wire),
      encodeJson: (value: TInferred): JsonValue => serializeToJsonSafe(value).json,
      decodeJson: (json: JsonValue) => validateSchema(json),
    }) as ArktypeJsonCodec<TInferred>;
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
 * @throws {Error} if the schema doesn't expose `expression` and `json`
 *   fields (i.e. is not an arktype `Type`). The factory validates the
 *   schema shape at the call site so configuration errors surface during
 *   contract authoring, not at runtime.
 */
export function arktypeJson<S extends Type<unknown>>(
  schema: S,
): ColumnTypeDescriptor & {
  readonly codecId: typeof ARKTYPE_JSON_CODEC_ID;
  readonly nativeType: typeof ARKTYPE_JSON_NATIVE_TYPE;
  readonly typeParams: ArktypeJsonTypeParams;
  readonly type: (ctx: CodecInstanceContext) => ArktypeJsonCodec<S['infer']>;
} {
  // Reject non-callable / non-arktype-shaped lookalikes before any
  // property reads. An object shaped like `{ expression, json }` would
  // otherwise pass the field checks and only explode on the first
  // `decode`/`decodeJson` call, defeating the early authoring-time
  // guard this factory provides. The `isArktypeSchemaLike` predicate
  // narrows `schema` so the descriptor builder hands the typed shape
  // straight to the curried factory — no `as unknown as` cast.
  if (!isArktypeSchemaLike(schema)) {
    throw new Error(
      typeof schema !== 'function'
        ? 'arktypeJson(schema) expects a callable arktype Type.'
        : 'arktypeJson(schema) expects an arktype Type (missing `expression: string`).',
    );
  }
  const jsonIr: unknown = (schema as { readonly json?: unknown }).json;
  if (jsonIr === null || typeof jsonIr !== 'object') {
    throw new Error('arktypeJson(schema) expects an arktype Type (missing `json` IR).');
  }
  return {
    codecId: ARKTYPE_JSON_CODEC_ID,
    nativeType: ARKTYPE_JSON_NATIVE_TYPE,
    typeParams: { expression: schema.expression, jsonIr },
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
 * Rehydrate an arktype schema from the serialized IR. Throws a clean
 * error if the IR is corrupt — the "corruption-of-contract.json" case.
 */
function rehydrateSchema(jsonIr: object): ArktypeSchemaLike {
  try {
    return ark.schema(jsonIr) as unknown as ArktypeSchemaLike;
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
 * Build a permissive `renderOutputType` that accepts the framework's
 * generic typeParams shape and dispatches to the type-narrow renderer
 * once the input is structurally an `ArktypeJsonTypeParams`.
 */
function renderArktypeJsonOutputTypeFromUnknownParams(
  typeParams: Record<string, unknown>,
): string | undefined {
  const expression = typeParams['expression'];
  const jsonIr = typeParams['jsonIr'];
  if (typeof expression !== 'string' || jsonIr === null || typeof jsonIr !== 'object') {
    return undefined;
  }
  return renderArktypeJsonOutputType({ expression, jsonIr });
}

/**
 * Metadata `Codec` instance for `arktype/json@1`. Threaded through the
 * pack-meta's `codecInstances` array (control plane) AND the runtime
 * descriptor's `types.codecTypes.codecInstances` (runtime plane) so two
 * codec-id-keyed lookups resolve:
 *
 * - The framework emitter's `CodecLookup` reads `renderOutputType` to
 *   stamp `Vector<…>` / arktype-schema-shaped types into `contract.d.ts`.
 * - The Postgres SQL renderer's `extractCodecLookup` reads
 *   `meta.db.sql.postgres.nativeType` to render `$N::jsonb` casts at
 *   parameter binding sites (`json` / `jsonb` are excluded from
 *   `POSTGRES_INFERRABLE_NATIVE_TYPES`, so the cast is not optional).
 *
 * The declared type is the framework `Codec` plus a structural intersection
 * carrying `meta`. We intentionally do NOT widen to the SQL `Codec`
 * extension here: `meta` is the only SQL-leaning slot the stub needs, and
 * coupling the family-agnostic descriptor's `codecInstances` slot to a
 * specific family layer would block reuse for any future non-SQL family
 * (e.g. a Mongo arktype variant) that wants the same renderer-lookup
 * shape. The SQL renderer reads `meta` structurally via its own
 * `as SqlCodec | undefined` cast at the lookup boundary, so the field
 * is consumed without requiring the source declaration to participate
 * in the SQL family's type hierarchy.
 *
 * Conversion methods (`encode` / `decode` / `encodeJson` / `decodeJson`)
 * are sentinels that throw if invoked — runtime dispatch goes through
 * `arktypeJsonCodec.factory(params)(ctx)` via the unified descriptor map,
 * never through this instance. The sentinels exist so a mistaken
 * contract-load that resolved to this stub fails fast at the JSON
 * boundary instead of silently returning unvalidated payloads. A future
 * cleanup that routes the emit path through `descriptorFor` and the
 * runtime cast lookup through the descriptor map retires this shim
 * (TML-2357).
 */
const ARKTYPE_JSON_RUNTIME_DISPATCH_ERROR =
  'arktype-json codec instances must be materialized via the descriptor factory; this is a metadata-only stub';

/**
 * Structural shape of the SQL renderer's `meta.db.sql.<dialect>.nativeType`
 * read. Co-located with the codec rather than imported from
 * `sql-relational-core` so this package's family-agnostic codec stub
 * doesn't depend on the SQL family's type hierarchy.
 */
type SqlNativeTypeMeta = {
  readonly db: {
    readonly sql: {
      readonly postgres: {
        readonly nativeType: 'jsonb';
      };
    };
  };
};

export const arktypeJsonEmitCodec: Codec<
  typeof ARKTYPE_JSON_CODEC_ID,
  readonly ['equality'],
  string,
  unknown
> & {
  readonly meta: SqlNativeTypeMeta;
} = {
  id: ARKTYPE_JSON_CODEC_ID,
  targetTypes: [ARKTYPE_JSON_NATIVE_TYPE],
  traits: ['equality'] as const,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'jsonb',
        },
      },
    },
  },
  encode: () => Promise.reject(new Error(ARKTYPE_JSON_RUNTIME_DISPATCH_ERROR)),
  decode: () => Promise.reject(new Error(ARKTYPE_JSON_RUNTIME_DISPATCH_ERROR)),
  encodeJson: () => {
    throw new Error(ARKTYPE_JSON_RUNTIME_DISPATCH_ERROR);
  },
  decodeJson: () => {
    throw new Error(ARKTYPE_JSON_RUNTIME_DISPATCH_ERROR);
  },
  renderOutputType: renderArktypeJsonOutputTypeFromUnknownParams,
};

/**
 * Framework-registration descriptor for the arktype-json codec. Registered
 * through the SQL runtime's `parameterizedCodecs:` slot. `sql-runtime`'s
 * `initializeTypeHelpers` (and per-column walk in
 * `buildContractCodecRegistry`) calls `arktypeJsonCodec.factory(typeParams)
 * (ctx)` once per `storage.types` instance (or once per inline-typeParams
 * column) to materialize the resolved codec carrying the rehydrated
 * schema.
 *
 * Per Phase B of codec-registry-unification, `descriptorFor('arktype/json@1')`
 * returns this descriptor and its `traits`/`targetTypes` are the codec-id-
 * keyed source of truth — no parallel placeholder on the legacy `codecs:`
 * slot is needed (the runtime descriptor ships `codecs: () => createCodecRegistry()`
 * — empty).
 */
export const arktypeJsonCodec: CodecDescriptor<ArktypeJsonTypeParams> = {
  codecId: ARKTYPE_JSON_CODEC_ID,
  traits: ['equality'] as const,
  targetTypes: [ARKTYPE_JSON_NATIVE_TYPE] as const,
  paramsSchema: arktypeJsonParamsSchema,
  renderOutputType: renderArktypeJsonOutputType,
  factory: (params) => {
    const schema = rehydrateSchema(params.jsonIr);
    // The rehydrated schema's `expression` must match the serialized one.
    // A mismatch means either contract.json was hand-edited or the
    // installed arktype version's IR-to-expression rendering diverged from
    // the version that produced contract.json — in both cases the emitted
    // `contract.d.ts` is no longer faithful to the runtime schema. Fail at
    // contract-load rather than warn: a runtime warning fires after the
    // wrong types have already shipped to consumers, and silent drift is
    // exactly what the round-trip-stability invariant is supposed to
    // prevent. See § Compatibility in the package README.
    const rehydratedExpression = (schema as { readonly expression?: unknown }).expression;
    if (typeof rehydratedExpression === 'string' && rehydratedExpression !== params.expression) {
      throw runtimeError(
        'RUNTIME.TYPE_PARAMS_INVALID',
        `arktype-json: typeParams.expression (${params.expression}) does not match the rehydrated schema's expression (${rehydratedExpression}). The contract was likely emitted against a different arktype version or hand-edited; re-run \`pnpm emit\` to regenerate.`,
        {
          codecId: ARKTYPE_JSON_CODEC_ID,
          serializedExpression: params.expression,
          rehydratedExpression,
        },
      );
    }
    return arktypeJsonCodecForSchema<unknown>(schema);
  },
};
