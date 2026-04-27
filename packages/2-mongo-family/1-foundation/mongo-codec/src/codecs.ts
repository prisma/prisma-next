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
> = BaseCodec<Id, TTraits, TWire, TInput>;

/**
 * Conditional bundle for `encodeJson`/`decodeJson`: when `TInput` is
 * structurally assignable to `JsonValue` the identity defaults are
 * sound and both fields are optional; otherwise both fields are
 * required so an author cannot silently produce a non-JSON-safe
 * contract artifact.
 */
type JsonRoundTripConfig<TInput> = [TInput] extends [JsonValue]
  ? {
      encodeJson?: (value: TInput) => JsonValue;
      decodeJson?: (json: JsonValue) => TInput;
    }
  : {
      encodeJson: (value: TInput) => JsonValue;
      decodeJson: (json: JsonValue) => TInput;
    };

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
 * required. `encodeJson` and `decodeJson` default to identity **only when
 * `TInput` is assignable to `JsonValue`**; otherwise both are required so
 * the contract artifact stays JSON-safe.
 */
export function mongoCodec<
  Id extends string,
  const TTraits extends readonly MongoCodecTrait[] = readonly [],
  TWire = unknown,
  TInput = unknown,
>(
  config: {
    typeId: Id;
    targetTypes: readonly string[];
    traits?: TTraits;
    encode?: (value: TInput) => TWire | Promise<TWire>;
    decode: (wire: TWire) => TInput | Promise<TInput>;
    renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
  } & JsonRoundTripConfig<TInput>,
): MongoCodec<Id, TTraits, TWire, TInput> {
  const identity = (v: unknown) => v;
  // The synchronous identity default is only safe when the author has
  // declared "the input is already the wire value" (i.e. TInput == TWire);
  // it returns the value directly, never a Promise.
  const userEncode = config.encode ?? ((value: TInput) => value as unknown as TWire);
  const userDecode = config.decode;
  const widenedConfig = config as {
    encodeJson?: (value: TInput) => JsonValue;
    decodeJson?: (json: JsonValue) => TInput;
  };
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
    encodeJson: (widenedConfig.encodeJson ?? identity) as (value: TInput) => JsonValue,
    decodeJson: (widenedConfig.decodeJson ?? identity) as (json: JsonValue) => TInput,
  };
}

/** Extract the JS application type carried by a Mongo codec — used both as `encode` input and as `decode` output. */
export type MongoCodecInput<T> =
  T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, infer TInput> ? TInput : never;

export type MongoCodecTraits<T> =
  T extends MongoCodec<string, infer TTraits> ? TTraits[number] & MongoCodecTrait : never;
