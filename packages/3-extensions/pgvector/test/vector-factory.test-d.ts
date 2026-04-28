import type {
  Codec,
  Ctx,
  ParameterizedCodecDescriptor,
} from '@prisma-next/framework-components/codec';
import type { pgVectorCodec } from '../src/exports/codecs';
import { vector } from '../src/exports/column-types';
import type { Vector } from '../src/types/codec-types';

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<_T extends true> = never;

// AC-1: vector(1536) descriptor's `type` slot is (ctx) => Codec<…, Vector<1536>>
const v1536 = vector(1536);
type V1536Type = typeof v1536.type;
export type _Vector_TakesCtx = Assert<IsEqual<Parameters<V1536Type>[0], Ctx>>;

// AC-1: literal numeric flow-through — Vector<1536>, not Vector<number>
type V1536Resolved = ReturnType<V1536Type>;
type V1536Js =
  V1536Resolved extends Codec<'pg/vector@1', readonly ['equality'], string, infer Js> ? Js : never;
export type _Vector_PreservesLiteral = Assert<IsEqual<V1536Js, Vector<1536>>>;

// Different N produces a distinct Js
const v768 = vector(768);
type V768Type = typeof v768.type;
type V768Resolved = ReturnType<V768Type>;
type V768Js =
  V768Resolved extends Codec<'pg/vector@1', readonly ['equality'], string, infer Js> ? Js : never;
export type _Vector_NotConflated = Assert<IsEqual<V768Js, Vector<768>>>;

// AC-1.e: pgVectorCodec descriptor's params shape is `{ readonly length: number }`
type DescriptorP = typeof pgVectorCodec extends ParameterizedCodecDescriptor<infer P> ? P : never;
export type _DescriptorParams = Assert<IsEqual<DescriptorP, { readonly length: number }>>;
