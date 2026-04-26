import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec as BaseCodec, CodecTrait } from '@prisma-next/framework-components/codec';
import { ifDefined } from '@prisma-next/utils/defined';

export type MongoCodecTrait = CodecTrait;

/**
 * Mongo codec interface — alias of the framework base codec.
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
  TJs = unknown,
> = BaseCodec<Id, TTraits, TWire, TJs>;

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
 */
export function mongoCodec<
  Id extends string,
  const TTraits extends readonly MongoCodecTrait[] = readonly [],
  TWire = unknown,
  TJs = unknown,
>(config: {
  typeId: Id;
  targetTypes: readonly string[];
  traits?: TTraits;
  encode: (value: TJs) => TWire | Promise<TWire>;
  decode: (wire: TWire) => TJs | Promise<TJs>;
  encodeJson?: (value: TJs) => JsonValue;
  decodeJson?: (json: JsonValue) => TJs;
  renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
}): MongoCodec<Id, TTraits, TWire, TJs> {
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
    encodeJson: (config.encodeJson ?? identity) as (value: TJs) => JsonValue,
    decodeJson: (config.decodeJson ?? identity) as (json: JsonValue) => TJs,
  };
}

export type MongoCodecJsType<T> =
  T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, infer TJs> ? TJs : never;

export type MongoCodecTraits<T> =
  T extends MongoCodec<string, infer TTraits> ? TTraits[number] & MongoCodecTrait : never;
