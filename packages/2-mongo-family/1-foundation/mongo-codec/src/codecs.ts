import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec as BaseCodec, CodecTrait } from '@prisma-next/framework-components/codec';
import { ifDefined } from '@prisma-next/utils/defined';

export type MongoCodecTrait = CodecTrait;

/**
 * A codec for the Mongo target. Translates between an application value
 * and the BSON-shaped wire form the Mongo driver exchanges, and between
 * an application value and the JSON form stored in contract artifacts.
 *
 * Same shape as the framework codec base — see `Codec` in
 * `@prisma-next/framework-components/codec` for the contract. The alias
 * exists so Mongo-specific metadata can be added here in future without
 * touching the framework base.
 */
export type MongoCodec<
  Id extends string = string,
  TTraits extends readonly MongoCodecTrait[] = readonly MongoCodecTrait[],
  TWire = unknown,
  TInput = unknown,
  TOutput = TInput,
> = BaseCodec<Id, TTraits, TWire, TInput, TOutput>;

/**
 * Construct a Mongo codec from author functions.
 *
 * Author `encode` and `decode` as sync or async functions; the factory
 * produces a {@link MongoCodec} whose query-time methods follow the
 * boundary contract documented on the framework {@link BaseCodec}.
 *
 * `encode` is optional — when omitted, an identity default is installed
 * (declaring "the input value already is the wire value", so `TInput` and
 * `TWire` are interchangeable for that codec). `decode` is always
 * required. `encodeJson` and `decodeJson` default to identity when
 * omitted.
 *
 * Most Mongo codecs use a single JS type for both writes (`TInput`) and
 * reads (`TOutput`). When you want a richer return type than you wrote
 * (e.g. write `string`, read `Date`), pass distinct types to `encode`'s
 * parameter and `decode`'s return.
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
  encode?: (value: TInput) => TWire | Promise<TWire>;
  decode: (wire: TWire) => TOutput | Promise<TOutput>;
  encodeJson?: (value: TInput) => JsonValue;
  decodeJson?: (json: JsonValue) => TInput;
  renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
}): MongoCodec<Id, TTraits, TWire, TInput, TOutput> {
  const identity = (v: unknown) => v;
  const userEncode =
    config.encode ?? ((value: TInput) => value as unknown as TWire | Promise<TWire>);
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
