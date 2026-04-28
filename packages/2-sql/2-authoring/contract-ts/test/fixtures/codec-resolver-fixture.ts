import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec, Ctx } from '@prisma-next/framework-components/codec';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ScalarFieldBuilder } from '../../src/contract-dsl';

/**
 * Synthetic test fixture for M2's `FieldOutputType` rewrite.
 *
 * Contains type-only stubs that mimic the eventual M4 authoring shape:
 * - A curried higher-order codec factory `vector(N)` that drives Case V
 *   (literal-typed numeric param preservation).
 * - A curried higher-order codec factory `json(schema)` that drives Case J
 *   (Standard-Schema-derived inference).
 * - A curried higher-order codec factory `cipherStashLike(params)` that drives
 *   Case C (`ctx.usedAt` is load-bearing).
 *
 * The fixture also exposes synthetic `Definition` shapes that exercise inline,
 * `typeRef`, non-parameterized, and nullable column variants. No production
 * codec is touched — these stubs only let us assert the type-level resolver.
 */

export interface VectorN<N extends number> {
  readonly length: N;
  readonly values: readonly number[];
}

export type VectorFactory<N extends number> = (
  ctx: Ctx,
) => Codec<'fixture/vector@1', readonly ['equality'], string, VectorN<N>>;

export declare function vector<N extends number>(length: N): VectorFactory<N>;

export type JsonFactory<S extends StandardSchemaV1> = (
  ctx: Ctx,
) => Codec<'fixture/json@1', readonly ['equality'], JsonValue, StandardSchemaV1.InferOutput<S>>;

export declare function json<S extends StandardSchemaV1>(schema: S): JsonFactory<S>;

export type CipherStashLikeFactory = (
  ctx: Ctx,
) => Codec<'fixture/cs@1', readonly ['equality'], string, string>;

export declare function cipherStashLike(params: {
  readonly keyId: string;
  readonly mode: 'deterministic' | 'randomized';
}): CipherStashLikeFactory;

export type ProductSchema = StandardSchemaV1<
  { readonly name: string; readonly price: number },
  { readonly name: string; readonly price: number }
>;
export declare const productSchema: ProductSchema;

export type ProductOutput = StandardSchemaV1.InferOutput<ProductSchema>;

/**
 * Synthetic field-state shape mirroring `ScalarFieldState` from the production
 * DSL but adding a `type` slot on the descriptor (the column-author-supplied
 * curried factory). M4 will surface that slot through the real DSL; for M2 the
 * fixture carries it directly so we can assert the type-level resolver.
 */
type ScalarFieldStateLike<
  CodecId extends string,
  Nullable extends boolean,
  Descriptor extends Record<string, unknown> | undefined = undefined,
  TypeRef extends string | undefined = undefined,
> = {
  readonly kind: 'scalar';
  readonly nullable: Nullable;
} & (Descriptor extends Record<string, unknown>
  ? { readonly descriptor: Descriptor & { readonly codecId: CodecId; readonly nativeType: string } }
  : Record<string, never>) &
  (TypeRef extends string ? { readonly typeRef: TypeRef } : Record<string, never>);

/**
 * Wrap a synthetic field state in `ScalarFieldBuilder<State>` so the production
 * `ModelFields` lookup (`stageOne.fields: Record<string, ScalarFieldBuilder>`)
 * accepts the fixture without changing the production type.
 */
type FieldOf<
  CodecId extends string,
  Nullable extends boolean,
  Descriptor extends Record<string, unknown> | undefined = undefined,
  TypeRef extends string | undefined = undefined,
> = ScalarFieldBuilder<ScalarFieldStateLike<CodecId, Nullable, Descriptor, TypeRef>>;

type ModelLike<Fields extends Record<string, unknown>> = {
  readonly stageOne: { readonly fields: Fields };
};

type InlineVectorDescriptor = {
  readonly codecId: 'fixture/vector@1';
  readonly nativeType: 'vector';
  readonly type: VectorFactory<1536>;
};

type InlineJsonDescriptor = {
  readonly codecId: 'fixture/json@1';
  readonly nativeType: 'jsonb';
  readonly type: JsonFactory<ProductSchema>;
};

type InlineCipherStashDescriptor = {
  readonly codecId: 'fixture/cs@1';
  readonly nativeType: 'text';
  readonly type: CipherStashLikeFactory;
};

type Int4Descriptor = {
  readonly codecId: 'fixture/int4@1';
  readonly nativeType: 'int4';
};

type NamedVector1536Type = {
  readonly codecId: 'fixture/vector@1';
  readonly nativeType: 'vector(1536)';
  readonly typeParams: { readonly length: 1536 };
  readonly type: VectorFactory<1536>;
};

type NamedNonParameterizedType = {
  readonly codecId: 'fixture/int4@1';
  readonly nativeType: 'int4';
  readonly typeParams: Record<string, never>;
};

export type FixtureCodecTypes = {
  readonly 'fixture/int4@1': { readonly output: number };
  readonly 'fixture/vector@1': { readonly output: readonly number[] };
  readonly 'fixture/json@1': { readonly output: JsonValue };
  readonly 'fixture/cs@1': { readonly output: string };
};

type FixtureFamilyTarget = {
  readonly kind: 'target';
  readonly id: 'fixture-target';
  readonly familyId: 'sql';
  readonly targetId: 'fixture-target';
  readonly version: '0.0.0';
  readonly __codecTypes?: FixtureCodecTypes;
};

export type FixtureDefinition = {
  readonly target: FixtureFamilyTarget;
  readonly types: {
    readonly Vector1536: NamedVector1536Type;
    readonly NamedInt4: NamedNonParameterizedType;
  };
  readonly models: {
    readonly Inline: ModelLike<{
      readonly id: FieldOf<'fixture/int4@1', false, Int4Descriptor>;
      readonly embedding: FieldOf<'fixture/vector@1', false, InlineVectorDescriptor>;
      readonly product: FieldOf<'fixture/json@1', false, InlineJsonDescriptor>;
      readonly secret: FieldOf<'fixture/cs@1', false, InlineCipherStashDescriptor>;
      readonly nullableEmbedding: FieldOf<'fixture/vector@1', true, InlineVectorDescriptor>;
    }>;
    readonly Named: ModelLike<{
      readonly id: FieldOf<'fixture/int4@1', false, Int4Descriptor>;
      readonly embedding: FieldOf<'fixture/vector@1', false, undefined, 'Vector1536'>;
      readonly nullableEmbedding: FieldOf<'fixture/vector@1', true, undefined, 'Vector1536'>;
      readonly counter: FieldOf<'fixture/int4@1', false, undefined, 'NamedInt4'>;
    }>;
  };
};
