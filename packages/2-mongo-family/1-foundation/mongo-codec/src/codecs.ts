import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec as BaseCodec, CodecTrait } from '@prisma-next/framework-components/codec';
import { ifDefined } from '@prisma-next/utils/defined';

export type MongoCodecTrait = CodecTrait;

/**
 * Mongo codec interface — alias of the framework base codec.
 *
 * Mirrors the SQL family's `Codec` shape so a single codec definition can
 * be registered in both SQL and Mongo registries (cross-family parity is
 * the project AC; see `projects/codec-async-single-path/spec.md`). The
 * generic list is identical to `BaseCodec`'s — `<Id, TTraits, TWire,
 * TInput, TOutput = TInput>` — so the Mongo surface is structurally
 * interchangeable with the SQL one. The asymmetric `TInput ≠ TOutput`
 * case (e.g. write `string`, read `Date`) is therefore expressible on
 * the Mongo side too.
 *
 * Query-time methods (`encode`, `decode`) are Promise-returning at the
 * boundary; the `mongoCodec()` factory accepts sync or async author
 * functions and lifts sync ones to Promise-shaped methods. Build-time
 * methods (`encodeJson`, `decodeJson`, `renderOutputType`) stay
 * synchronous so `validateMongoContract` and client construction remain
 * synchronous.
 *
 * Mongo-specific extensions (e.g. parameterized codecs, target hints) are
 * not currently needed; this alias keeps the Mongo surface in lockstep
 * with the framework base. Any divergence should be added here.
 */
export type MongoCodec<
  Id extends string = string,
  TTraits extends readonly MongoCodecTrait[] = readonly MongoCodecTrait[],
  TWire = unknown,
  TInput = unknown,
  TOutput = TInput,
> = BaseCodec<Id, TTraits, TWire, TInput, TOutput>;

/**
 * Mongo codec factory — mirrors the unified `codec()` factory in
 * `@prisma-next/sql-relational-core/ast` so a single codec definition can
 * be reused across SQL and Mongo registries.
 *
 * Authors may write `encode` / `decode` as sync or async; the factory
 * lifts uniformly to Promise-returning methods via `async (x) => fn(x)`.
 * Build-time methods (`encodeJson`, `decodeJson`, `renderOutputType`)
 * pass through synchronously; identity defaults are installed for the
 * JSON methods when omitted.
 *
 * `TInput` is the JS type accepted on writes; `TOutput` is the JS type
 * produced on reads (defaults to `TInput`). The asymmetric form is
 * expressible by passing distinct types to `encode`'s parameter and
 * `decode`'s return. The author-provided `encodeJson` (when omitted,
 * identity) maps `TInput → JsonValue`; `decodeJson` returns the input
 * type so `validateContract` round-trips author-provided JSON forms.
 */
export function mongoCodec<
  Id extends string,
  const TTraits extends readonly MongoCodecTrait[] = readonly [],
  TWire = unknown,
  TInput = unknown,
  TOutput = TInput,
>(config: {
  typeId: Id;
  targetTypes: readonly string[];
  traits?: TTraits;
  encode: (value: TInput) => TWire | Promise<TWire>;
  decode: (wire: TWire) => TOutput | Promise<TOutput>;
  encodeJson?: (value: TInput) => JsonValue;
  decodeJson?: (json: JsonValue) => TInput;
  renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
}): MongoCodec<Id, TTraits, TWire, TInput, TOutput> {
  const identity = (v: unknown) => v;
  const userEncode = config.encode;
  const userDecode = config.decode;
  return {
    id: config.typeId,
    targetTypes: config.targetTypes,
    ...ifDefined(
      'traits',
      config.traits ? (Object.freeze([...config.traits]) as TTraits) : undefined,
    ),
    ...ifDefined('renderOutputType', config.renderOutputType),
    encode: async (value) => userEncode(value),
    decode: async (wire) => userDecode(wire),
    encodeJson: (config.encodeJson ?? identity) as (value: TInput) => JsonValue,
    decodeJson: (config.decodeJson ?? identity) as (json: JsonValue) => TInput,
  };
}

/** Extract the JS input type accepted by a Mongo codec's `encode`. */
export type MongoCodecInput<T> =
  T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, infer TInput> ? TInput : never;

/** Extract the JS output type produced by a Mongo codec's `decode`. */
export type MongoCodecOutput<T> =
  T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, unknown, infer TOutput>
    ? TOutput
    : never;

export type MongoCodecTraits<T> =
  T extends MongoCodec<string, infer TTraits> ? TTraits[number] & MongoCodecTrait : never;
