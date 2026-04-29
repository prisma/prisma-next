import type { Codec, CodecDescriptor, Ctx } from '@prisma-next/framework-components/codec';
import { type } from 'arktype';
import { type ArktypeJsonTypeParams, arktypeJson } from '../src/core/arktype-json-codec';
import type { arktypeJsonCodec } from '../src/exports/codecs';

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<_T extends true> = never;

// AC-7: arktypeJson(schema).type is (ctx) => Codec<…, S['infer']>
const productSchema = type({
  name: 'string',
  price: 'number',
});

const product = arktypeJson(productSchema);
type ProductType = typeof product.type;

export type _Arktype_TakesCtx = Assert<IsEqual<Parameters<ProductType>[0], Ctx>>;

type ProductResolved = ReturnType<ProductType>;
type ProductJs =
  ProductResolved extends Codec<'arktype/json@1', readonly ['equality'], string, infer Js>
    ? Js
    : never;

// The schema's inferred output flows into the codec's Js slot — narrowed
// fields, optional markers, literal types all preserved.
type ProductInfer = typeof productSchema.infer;
export type _ProductJs_MatchesInfer = Assert<IsEqual<ProductJs, ProductInfer>>;

// Different schemas produce distinct Js — no conflation through the codec id.
const auditSchema = type({
  actor: "'system' | 'user' | 'admin'",
  at: 'number',
});
const audit = arktypeJson(auditSchema);
type AuditType = typeof audit.type;
type AuditResolved = ReturnType<AuditType>;
type AuditJs =
  AuditResolved extends Codec<'arktype/json@1', readonly ['equality'], string, infer Js>
    ? Js
    : never;
type AuditInfer = typeof auditSchema.infer;
export type _AuditJs_MatchesInfer = Assert<IsEqual<AuditJs, AuditInfer>>;
export type _AuditJs_NotConflatedWithProduct = Assert<IsEqual<IsEqual<AuditJs, ProductJs>, false>>;

// arktypeJsonCodec descriptor's typeParams shape is `ArktypeJsonTypeParams`.
type DescriptorP = typeof arktypeJsonCodec extends CodecDescriptor<infer P> ? P : never;
export type _DescriptorParams = Assert<IsEqual<DescriptorP, ArktypeJsonTypeParams>>;
