/**
 * Class-based form of the arktype-json codec (TML-2357 M0 Phase B4).
 *
 * Spec § Case 3: method-level generic over `S extends Type<unknown>`.
 * The schema's TypeScript-level inferred type `S['infer']` is only
 * available at the column-author site (where the user passes their
 * typed schema), not at the descriptor's factory site (where only the
 * serialized IR is available). This drives the shape:
 *
 * 1. {@link ArktypeJsonCodecClass} extends {@link CodecImpl} and is
 *    generic over `TInferred` — the application-level JS type the
 *    schema validates to. The constructor takes both the descriptor
 *    (for `id` proxy) and the rehydrated arktype `Type` (closure-captured
 *    so encode/decode/encodeJson/decodeJson can validate through it).
 * 2. {@link ArktypeJsonDescriptor} extends {@link CodecDescriptorImpl}
 *    over {@link ArktypeJsonTypeParams}. Factory rehydrates the schema
 *    from `params.jsonIr` and returns
 *    `(ctx) => new ArktypeJsonCodecClass<unknown>(this, schema)` — `S`
 *    is erased to `unknown` because the descriptor only sees IR. The
 *    runtime path through `descriptor.factory(params)` always exists
 *    (e.g. for `validateContract` re-materialization); it just loses
 *    the typed inferred shape.
 * 3. {@link arktypeJsonColumn} is the column-author surface with the
 *    method-level generic over `S extends Type<unknown>`. It bypasses
 *    `descriptor.factory` because `S` is only available here, instead
 *    constructing the typed codec directly so `S['infer']` flows
 *    through `codecFactory`'s return into the column site's resolved
 *    output type. Eager serialization at this call site captures
 *    `expression` (for the emit-path renderer) and `jsonIr` (for
 *    runtime rehydration), matching the legacy `arktypeJson(schema)`
 *    factory.
 *
 * `satisfies ColumnHelperFor<ArktypeJsonDescriptor>` (coarse) is
 * applied — the typeParams shape is verified. `ColumnHelperForStrict`
 * is intentionally skipped: the descriptor's factory return is
 * `ArktypeJsonCodecClass<unknown>` while the helper produces
 * `ArktypeJsonCodecClass<S['infer']>`, and `Codec`'s `TInput` is
 * invariant (used contravariantly in `encode`, covariantly in
 * `decode`/`encodeJson`/`decodeJson`). Strict assignment fails by
 * design; the explicit `expectTypeOf` tests in
 * `test/arktype-json-codec-class.types.test-d.ts` cover the literal-
 * preservation property the strict variant would otherwise enforce.
 *
 * The legacy `mkCodec` / `defineCodec`-shaped exports in
 * `arktype-json-codec.ts` (`arktypeJson(schema)` column factory and
 * the `arktypeJsonCodec` descriptor) remain during M0 Phase B for
 * compatibility with downstream consumers; both forms coexist until
 * Phase C.
 */

import { arktypeParamsSchema, type JsonValue } from '@prisma-next/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnSpec,
  column,
} from '@prisma-next/framework-components/codec';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import { ArkErrors, ark, type Type, type } from 'arktype';
import {
  ARKTYPE_JSON_CODEC_ID,
  ARKTYPE_JSON_NATIVE_TYPE,
  type ArktypeJsonTypeParams,
} from './arktype-json-codec';

// ---------------------------------------------------------------------------
// Schema-shape narrow + structural guard. Mirrors the private types in
// arktype-json-codec.ts. Kept private (not re-exported) so the legacy
// surface remains the single source of public arktype-shaped helpers.
// ---------------------------------------------------------------------------

type ArktypeSchemaLike = ((value: unknown) => unknown) & {
  readonly expression: string;
};

function isArktypeSchemaLike(value: unknown): value is ArktypeSchemaLike {
  if (typeof value !== 'function') return false;
  const expression = (value as { readonly expression?: unknown }).expression;
  return typeof expression === 'string';
}

// ---------------------------------------------------------------------------
// Shared encode/decode pipeline. Identical semantics to the legacy
// `arktypeJsonCodecForSchema` in `arktype-json-codec.ts` — pulled into
// free functions so both class methods and the legacy mkCodec path can
// converge on one implementation when Phase C consolidates.
// ---------------------------------------------------------------------------

function validateSchema<TInferred>(schema: ArktypeSchemaLike, value: unknown): TInferred {
  const result = schema(value);
  if (result instanceof ArkErrors) {
    throw runtimeError(
      'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
      `arktype-json schema validation failed (decode): ${result.summary}`,
      { codecId: ARKTYPE_JSON_CODEC_ID, issues: result.summary },
    );
  }
  return result as TInferred;
}

function serializeToJsonSafe<TInferred>(
  schema: ArktypeSchemaLike,
  value: TInferred,
): { wire: string; json: JsonValue } {
  const wire: string | undefined = JSON.stringify(value);
  if (typeof wire !== 'string') {
    throw runtimeError(
      'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
      `arktype-json value is not representable as JSON (codecId: ${ARKTYPE_JSON_CODEC_ID})`,
      { codecId: ARKTYPE_JSON_CODEC_ID },
    );
  }
  const json = JSON.parse(wire) as JsonValue;
  validateSchema(schema, json);
  return { wire, json };
}

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

function renderArktypeJsonOutputType(params: ArktypeJsonTypeParams): string {
  const expression = params.expression.trim();
  return expression.length > 0 ? expression : 'unknown';
}

// ---------------------------------------------------------------------------
// arktype/json@1 — non-parameterized at the codec class level (the
// schema is constructor-captured, not a runtime params record);
// parameterized at the descriptor level (typeParams record carries
// expression + jsonIr in contract.json).
// ---------------------------------------------------------------------------

export class ArktypeJsonCodecClass<TInferred> extends CodecImpl<
  typeof ARKTYPE_JSON_CODEC_ID,
  readonly ['equality'],
  string,
  TInferred
> {
  constructor(
    descriptor: ArktypeJsonDescriptor,
    private readonly schema: ArktypeSchemaLike,
  ) {
    super(descriptor);
  }

  async encode(value: TInferred, _ctx: CodecCallContext): Promise<string> {
    return serializeToJsonSafe(this.schema, value).wire;
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<TInferred> {
    return validateSchema<TInferred>(this.schema, JSON.parse(wire));
  }

  encodeJson(value: TInferred): JsonValue {
    return serializeToJsonSafe(this.schema, value).json;
  }

  decodeJson(json: JsonValue): TInferred {
    return validateSchema<TInferred>(this.schema, json);
  }
}

const arktypeJsonParamsSchema = type({
  expression: 'string',
  jsonIr: 'object',
});

export class ArktypeJsonDescriptor extends CodecDescriptorImpl<ArktypeJsonTypeParams> {
  override readonly codecId = ARKTYPE_JSON_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = [ARKTYPE_JSON_NATIVE_TYPE] as const;
  override readonly paramsSchema =
    arktypeParamsSchema<ArktypeJsonTypeParams>(arktypeJsonParamsSchema);
  override renderOutputType(params: ArktypeJsonTypeParams): string {
    return renderArktypeJsonOutputType(params);
  }
  override factory(
    params: ArktypeJsonTypeParams,
  ): (ctx: CodecInstanceContext) => ArktypeJsonCodecClass<unknown> {
    const schema = rehydrateSchema(params.jsonIr);
    /* c8 ignore start — defensive parity check; not exercised by typical contracts */
    const rehydratedExpression = (schema as { readonly expression?: unknown }).expression;
    if (typeof rehydratedExpression === 'string' && rehydratedExpression !== params.expression) {
      console.warn(
        `[arktype-json] typeParams.expression (${params.expression}) does not match rehydrated schema expression (${rehydratedExpression}); contract.json may be stale relative to the runtime schema.`,
      );
    }
    /* c8 ignore stop */
    return () => new ArktypeJsonCodecClass<unknown>(this, schema);
  }
}

export const arktypeJsonDescriptorClass = new ArktypeJsonDescriptor();

/**
 * Per-codec column helper for `arktype/json@1`. Method-level generic
 * over `S extends Type<unknown>` so the column site preserves the
 * schema's inferred TS type in the resolved codec
 * (`ArktypeJsonCodecClass<S['infer']>`). Bypasses `descriptor.factory`
 * because `S` is only available at the column-author site; constructs
 * the typed codec directly with the closure-captured schema.
 *
 * Eager serialization at this call site captures `expression` (for the
 * emit-path renderer) and `jsonIr` (for runtime rehydration via the
 * descriptor's factory), matching the legacy `arktypeJson(schema)`
 * factory's eager-extraction behaviour.
 *
 * @throws {Error} if the schema doesn't expose `expression` and `json`
 *   fields (i.e. is not an arktype `Type`). Validates the schema shape
 *   at the call site so configuration errors surface during contract
 *   authoring, not at runtime.
 */
export function arktypeJsonColumn<S extends Type<unknown>>(
  schema: S,
): ColumnSpec<ArktypeJsonCodecClass<S['infer']>, ArktypeJsonTypeParams> {
  if (!isArktypeSchemaLike(schema)) {
    throw new Error(
      typeof schema !== 'function'
        ? 'arktypeJsonColumn(schema) expects a callable arktype Type.'
        : 'arktypeJsonColumn(schema) expects an arktype Type (missing `expression: string`).',
    );
  }
  const jsonIr: unknown = (schema as { readonly json?: unknown }).json;
  if (jsonIr === null || typeof jsonIr !== 'object') {
    throw new Error('arktypeJsonColumn(schema) expects an arktype Type (missing `json` IR).');
  }
  const params: ArktypeJsonTypeParams = { expression: schema.expression, jsonIr };
  return column(
    (_ctx: CodecInstanceContext) =>
      new ArktypeJsonCodecClass<S['infer']>(arktypeJsonDescriptorClass, schema),
    arktypeJsonDescriptorClass.codecId,
    params,
    ARKTYPE_JSON_NATIVE_TYPE,
  );
}

arktypeJsonColumn satisfies ColumnHelperFor<ArktypeJsonDescriptor>;
// Note: `ColumnHelperForStrict` is intentionally not applied — `Codec` is
// invariant in `TInput` (encode contravariant, decode covariant), so
// `ArktypeJsonCodecClass<S['infer']>` is not assignable to
// `ArktypeJsonCodecClass<unknown>` (the descriptor.factory return).
// `expectTypeOf` tests cover the literal-preservation property strict
// satisfies would otherwise enforce.

// ---------------------------------------------------------------------------
// Class-form descriptor list (TML-2357 M0 Phase B5). Single entry today:
// `arktype/json@1`. The arktype-json contributor pack's unified `codecs:`
// slot consumption swaps from the legacy `arktypeJsonCodec`
// `defineCodec()` carrier to the class-form descriptor without changing
// the descriptor's `targetTypes`/`meta`/`renderOutputType` shape.
// ---------------------------------------------------------------------------

export const codecDescriptorClassList: readonly AnyCodecDescriptor[] = [arktypeJsonDescriptorClass];
