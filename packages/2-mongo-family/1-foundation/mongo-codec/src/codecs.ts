import type { JsonValue } from '@prisma-next/contract/types';
import type {
  Codec as BaseCodec,
  CodecCallContext,
  CodecTrait,
} from '@prisma-next/framework-components/codec';
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
    encode?:
      | ((value: TInput) => TWire | Promise<TWire>)
      | ((value: TInput, ctx: CodecCallContext) => TWire | Promise<TWire>);
    decode:
      | ((wire: TWire) => TInput | Promise<TInput>)
      | ((wire: TWire, ctx: CodecCallContext) => TInput | Promise<TInput>);
    renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
  } & JsonRoundTripConfig<TInput>,
): MongoCodec<Id, TTraits, TWire, TInput> {
  const identity = (v: unknown) => v;
  // The synchronous identity default is only safe when the author has
  // declared "the input is already the wire value" (i.e. TInput == TWire);
  // it returns the value directly, never a Promise. Authors who want the
  // identity default never observe `ctx`, so the parameter is omitted here.
  // The union typing on `config.encode` / `config.decode` (single- or two-
  // arg authors) preserves TInput inference at call sites; widen to the
  // two-arg shape inside the factory body so the lift can forward ctx.
  type CtxEncode = (value: TInput, ctx?: CodecCallContext) => TWire | Promise<TWire>;
  type CtxDecode = (wire: TWire, ctx?: CodecCallContext) => TInput | Promise<TInput>;
  const userEncode: CtxEncode =
    (config.encode as CtxEncode | undefined) ?? ((value: TInput) => value as unknown as TWire);
  const userDecode: CtxDecode = config.decode as CtxDecode;
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
    encode: (value, ctx) => {
      try {
        return Promise.resolve(userEncode(value, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    decode: (wire, ctx) => {
      try {
        return Promise.resolve(userDecode(wire, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    encodeJson: (widenedConfig.encodeJson ?? identity) as (value: TInput) => JsonValue,
    decodeJson: (widenedConfig.decodeJson ?? identity) as (json: JsonValue) => TInput,
  };
}

/** Extract the JS application type carried by a Mongo codec — used both as `encode` input and as `decode` output. */
export type MongoCodecInput<T> =
  T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, infer TInput> ? TInput : never;

export type MongoCodecTraits<T> =
  T extends MongoCodec<string, infer TTraits> ? TTraits[number] & MongoCodecTrait : never;
