/**
 * Higher-order codec factory for Postgres JSON columns with Standard-Schema-driven
 * type inference (M3 of the codec-model-unification project, AC-5).
 *
 * Pack-author surface: users write `json(productSchema)` at a column site and the
 * column's TS type resolves to `StandardSchemaV1.InferOutput<typeof productSchema>`
 * via M2's no-emit `FieldOutputType` resolver. The same schema validates wire
 * payloads at runtime inside `decode`.
 *
 * Two exports:
 * - `json<S>(schema)` — the curried higher-order codec factory.
 * - `pgJsonCodec` — the sister `ParameterizedCodecDescriptor` that registers
 *   the factory with the framework.
 *
 * The legacy `json(schema?)` helper at `../exports/column-types.ts` (a
 * `ColumnTypeDescriptor` factory pre-dating the higher-order model) stays in
 * place until M4 migrates production codecs to this shape; M3 ships the new
 * surface side-by-side without rewiring production. See
 * `projects/codec-model-unification/plan.md § M3` and
 * `projects/codec-model-unification/design/authoring-ergonomics.md § JSON factory`.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import type {
  Codec,
  Ctx,
  ParameterizedCodecDescriptor,
} from '@prisma-next/framework-components/codec';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { PG_JSON_CODEC_ID } from '../core/codec-ids';

/**
 * The codec returned by `json(schema)(ctx)`. The `Js` slot carries the
 * schema's `InferOutput`, which the no-emit `FieldOutputType` reads at the
 * column site.
 */
export type JsonCodec<S extends StandardSchemaV1> = Codec<
  typeof PG_JSON_CODEC_ID,
  readonly ['equality'],
  string,
  StandardSchemaV1.InferOutput<S>
>;

/**
 * Curried higher-order codec factory for JSON columns with a Standard Schema.
 *
 * Usage:
 *
 * ```ts
 * import { type } from 'arktype';
 * import { json } from '@prisma-next/adapter-postgres/codecs';
 *
 * const ProductSchema = type({ name: 'string', price: 'number' });
 *
 * const Product = {
 *   columns: {
 *     id: textCodec,
 *     settings: json(ProductSchema),
 *     //        ^? (ctx) => Codec<…, { name: string; price: number }>
 *   },
 * };
 * ```
 *
 * The body of `decode` validates the parsed wire payload against the same
 * schema; on failure it throws `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` so
 * the runtime error envelope stays uniform with the existing JSON validator
 * registry path at `@prisma-next/sql-runtime`.
 */
export function json<S extends StandardSchemaV1>(schema: S): (ctx: Ctx) => JsonCodec<S> {
  return (_ctx) => {
    type JsType = StandardSchemaV1.InferOutput<S>;
    return {
      id: PG_JSON_CODEC_ID,
      targetTypes: ['json'] as const,
      traits: ['equality'] as const,
      encode(value: JsType): string {
        return JSON.stringify(value);
      },
      decode(wire: string): JsType {
        const parsed: unknown = JSON.parse(wire);
        const result = schema['~standard'].validate(parsed);
        if (result instanceof Promise) {
          throw runtimeError(
            'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
            `JSON schema validation failed: schema for codec '${PG_JSON_CODEC_ID}' returned a Promise; runtime validation requires a synchronous Standard Schema validator.`,
            { codecId: PG_JSON_CODEC_ID },
          );
        }
        if (result.issues) {
          const issues = result.issues.map((issue) => issue.message).join('; ');
          throw runtimeError(
            'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
            `JSON schema validation failed for codec '${PG_JSON_CODEC_ID}' (decode): ${issues}`,
            { codecId: PG_JSON_CODEC_ID, issues: result.issues },
          );
        }
        // Standard Schema's `~standard.validate` is typed `(value: unknown) =>
        // Result<unknown>` — the spec types `validate` against the unconstrained
        // variant even when the schema's `S` is fully captured. At this call
        // site `S` is captured from the factory's generic parameter, so
        // `result.value` is structurally `StandardSchemaV1.InferOutput<S>` once
        // the issues branch above is excluded.
        return result.value as JsType;
      },
      encodeJson(value: JsType): JsonValue {
        // The contract IR's JSON-side surface (`encodeJson`/`decodeJson`) is
        // typed against `JsonValue` for serialization; the JS-side type `JsType`
        // is whatever the user's schema produced. There is no general structural
        // assertion that `JsType` is a `JsonValue` (a schema may emit `Date`,
        // class instances, etc.) — the cast is a wire-level identity by
        // contract: the caller of `encodeJson` agrees the value is JSON-safe.
        return value as JsonValue;
      },
      decodeJson(jsonValue: JsonValue): JsType {
        // Symmetric with `encodeJson`: the JSON-side input is contract-level
        // JSON-safe data, and the schema-derived `JsType` is what the user code
        // expects to consume. The JSON wire is structurally identical to the
        // codec's JS form for json columns; runtime validation lives in
        // `decode` (above), not on the contract-load path.
        return jsonValue as JsType;
      },
    };
  };
}

/**
 * Validator for the descriptor's params: the params object must carry a
 * `schema` field that is itself a Standard Schema (i.e. has `~standard`).
 *
 * Implemented inline as a Standard Schema rather than depending on arktype to
 * keep this codec independent of any one validator library; the check is
 * intentionally minimal — it asserts the `~standard` brand and defers shape
 * checks to the user's schema library.
 */
function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  // Standard Schemas may be either objects or callable functions (e.g. arktype's
  // `Type` is itself a function carrying the `~standard` brand). Accept both.
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  const candidate = (value as { readonly '~standard'?: unknown })['~standard'];
  return typeof candidate === 'object' && candidate !== null;
}

const jsonParamsSchema: StandardSchemaV1<{ readonly schema: StandardSchemaV1 }> = {
  '~standard': {
    version: 1,
    vendor: '@prisma-next/adapter-postgres',
    validate(input: unknown) {
      if (input === null || typeof input !== 'object') {
        return {
          issues: [{ message: 'pgJsonCodec params must be an object' }],
        };
      }
      const candidate = (input as { readonly schema?: unknown }).schema;
      if (!isStandardSchema(candidate)) {
        return {
          issues: [
            {
              message:
                'pgJsonCodec params.schema must be a Standard Schema (i.e. expose a `~standard` brand)',
              path: ['schema'],
            },
          ],
        };
      }
      return { value: { schema: candidate } };
    },
  },
};

/**
 * Read the schema's TypeScript source expression, if its library exposes one.
 * Arktype attaches `.expression: string` (e.g. `{ name: string, price: number }`)
 * to its `Type` values; the renderer reads it directly. For schemas without a
 * surfaced TS source the renderer returns `'unknown'` per design § JSON factory:
 *
 * > For schemas Standard Schema can't render to a TS source string for the
 * > emit path, `renderOutputType` returns `'unknown'`; the no-emit path keeps
 * > the precise inference.
 */
function renderSchemaOutputType(schema: StandardSchemaV1): string {
  const expression = (schema as { readonly expression?: unknown }).expression;
  if (typeof expression !== 'string') return 'unknown';
  const trimmed = expression.trim();
  return trimmed.length > 0 ? trimmed : 'unknown';
}

/**
 * Sister descriptor that registers the JSON factory with the framework. Its
 * `factory` field unwraps `params.schema` and delegates to `json(schema)`; this
 * keeps the user-facing surface (`json(schema)`) idiomatic while satisfying the
 * descriptor's `(params: { schema: StandardSchemaV1 }) => (ctx) => Codec` shape.
 */
export const pgJsonCodec: ParameterizedCodecDescriptor<{ readonly schema: StandardSchemaV1 }> = {
  codecId: PG_JSON_CODEC_ID,
  paramsSchema: jsonParamsSchema,
  renderOutputType: ({ schema }) => renderSchemaOutputType(schema),
  factory: ({ schema }) => json(schema),
};
