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
 * `@prisma-next/framework-components/codec` for the contract.
 *
 * `traits`, `targetTypes`, and `renderOutputType` are redeclared here as
 * transitional fields because the framework {@link BaseCodec} no longer
 * carries them — codec-id-keyed static metadata lives on the unified
 * {@link import('@prisma-next/framework-components/codec').CodecDescriptor}.
 * Mongo's full migration to descriptor-side registration is tracked
 * under TML-2324; until that lands, the legacy fields keep production
 * Mongo wire metadata (BSON-type derivation in
 * `@prisma-next/mongo-contract-psl`, emit-path renderer for
 * `Vector<N>`) reachable through the structural-narrow path in
 * `extractCodecLookup`.
 */
export interface MongoCodec<
  Id extends string = string,
  TTraits extends readonly MongoCodecTrait[] = readonly MongoCodecTrait[],
  TWire = unknown,
  TInput = unknown,
> extends BaseCodec<Id, TTraits, TWire, TInput> {
  /** Transitional. See interface-level comment. */
  readonly traits?: TTraits;
  /**
   * Transitional. See interface-level comment. Optional because a
   * resolved codec returned by a {@link import('@prisma-next/framework-components/codec').CodecDescriptor}'s
   * `factory` (framework {@link BaseCodec}) is structurally narrower;
   * the `mongoCodec()` factory always populates the slot at the
   * registration boundary.
   */
  readonly targetTypes?: readonly string[];
  /** Transitional. See interface-level comment. */
  readonly renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
}

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
 * Authors receive a second `ctx` options argument carrying the per-call
 * context; ignore it if you don't need it.
 *
 * Both `encode` and `decode` are required so `TInput` and `TWire` are
 * always covered by an explicit author function — the factory installs
 * no identity fallback. `encodeJson` and `decodeJson` default to identity
 * **only when `TInput` is assignable to `JsonValue`**; otherwise both are
 * required so the contract artifact stays JSON-safe.
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
    encode: (value: TInput, ctx: CodecCallContext) => TWire | Promise<TWire>;
    decode: (wire: TWire, ctx: CodecCallContext) => TInput | Promise<TInput>;
    renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
  } & JsonRoundTripConfig<TInput>,
): MongoCodec<Id, TTraits, TWire, TInput> {
  const identity = (v: unknown) => v;
  // The runtime allocates one `CodecCallContext` per `runtime.execute()`
  // call (no caller-supplied `signal` produces `{}` instead of `undefined`)
  // and threads it as a non-optional reference to every codec call. The
  // author surface keeps the second parameter optional so single-arg
  // `(value) => …` authors continue to satisfy the signature via
  // TypeScript's bivariance for trailing parameters.
  const userEncode = config.encode;
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
