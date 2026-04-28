import type {
  Codec,
  Ctx,
  ParameterizedCodecDescriptor,
} from '@prisma-next/framework-components/codec';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type as arktype } from 'arktype';
import { json, type pgJsonCodec } from '../src/codecs/json-factory';

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<_T extends true> = never;

const productSchema = arktype({
  name: 'string',
  price: 'number',
});
type ProductInferred = typeof productSchema.infer;

// AC-5.a: json(schema) returns (ctx) => Codec<…, InferOutput<typeof schema>>
const partial = json(productSchema);
type PartialFn = typeof partial;
export type _Partial_TakesCtx = Assert<IsEqual<Parameters<PartialFn>[0], Ctx>>;

type Resolved = ReturnType<PartialFn>;
type ResolvedJs =
  Resolved extends Codec<string, readonly ['equality'], string, infer Js> ? Js : never;

// AC-5.a: factory's Js slot is the schema's InferOutput
export type _ResolvedJs_IsInferOutput = Assert<IsEqual<ResolvedJs, ProductInferred>>;

// AC-5.a: codec id is the literal `pg/json@1`
export type _CodecId_IsPgJson = Assert<
  IsEqual<
    Resolved extends Codec<infer Id, readonly ['equality'], string, ProductInferred> ? Id : never,
    'pg/json@1'
  >
>;

// AC-5.a: traits include 'equality'
export type _Traits_IncludeEquality = Assert<
  IsEqual<
    Resolved extends Codec<'pg/json@1', infer Traits, string, ProductInferred> ? Traits : never,
    readonly ['equality']
  >
>;

// AC-5.a: a different schema flows through with its own InferOutput
const userSchema = arktype({
  email: 'string',
  age: 'number',
});
type UserInferred = typeof userSchema.infer;
type UserResolved = ReturnType<typeof json<typeof userSchema>>;
type UserJs =
  ReturnType<UserResolved> extends Codec<string, readonly ['equality'], string, infer Js>
    ? Js
    : never;
export type _UserSchema_FlowsThrough = Assert<IsEqual<UserJs, UserInferred>>;

// AC-5.b: pgJsonCodec descriptor's params shape is `{ schema: StandardSchemaV1 }`.
type DescriptorP = typeof pgJsonCodec extends ParameterizedCodecDescriptor<infer P> ? P : never;
export type _DescriptorParams_IsSchemaWrapper = Assert<
  IsEqual<DescriptorP, { readonly schema: StandardSchemaV1 }>
>;
