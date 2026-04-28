import type { Contract, ContractModelBase, ProfileHashBase } from '@prisma-next/contract/types';
import type { Codec, Ctx } from '@prisma-next/framework-components/codec';
import type { SqlStorage, TypeMaps, TypeMapsPhantomKey } from '@prisma-next/sql-contract/types';
import type { ComputeColumnJsType } from '@prisma-next/sql-relational-core/types';

/**
 * Confirms the design claim that `ComputeColumnJsType` picks up the M2 fix
 * transparently through `ExtractFieldOutputTypes<Contract>`. Mirrors the
 * synthetic fixture in `@prisma-next/sql-contract-ts`'s test suite and asserts
 * the cross-package delegation produces the same resolved type.
 */

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<_T extends true> = never;

interface VectorN<N extends number> {
  readonly length: N;
  readonly values: readonly number[];
}

type FixtureCodecTypes = {
  readonly 'fixture/int4@1': { readonly output: number };
  readonly 'fixture/vector@1': { readonly output: readonly number[] };
};

type VectorFactory<N extends number> = (
  ctx: Ctx,
) => Codec<'fixture/vector@1', readonly ['equality'], string, VectorN<N>>;

type InlineEmbeddingColumn = {
  readonly nativeType: 'vector(1536)';
  readonly codecId: 'fixture/vector@1';
  readonly nullable: false;
  readonly typeParams: { readonly length: 1536 };
  readonly type: VectorFactory<1536>;
};

type NamedEmbeddingColumn = {
  readonly nativeType: 'vector(1536)';
  readonly codecId: 'fixture/vector@1';
  readonly nullable: false;
  readonly typeRef: 'Vector1536';
};

type NullableInlineEmbeddingColumn = Omit<InlineEmbeddingColumn, 'nullable'> & {
  readonly nullable: true;
};

type IdColumn = {
  readonly nativeType: 'int4';
  readonly codecId: 'fixture/int4@1';
  readonly nullable: false;
};

type FixtureFieldOutputTypes = {
  readonly Inline: {
    readonly id: number;
    readonly embedding: VectorN<1536>;
    readonly nullableEmbedding: VectorN<1536> | null;
  };
  readonly Named: {
    readonly embedding: VectorN<1536>;
  };
};

type FixtureStorage = SqlStorage & {
  readonly tables: {
    readonly Inline: {
      readonly columns: {
        readonly id: IdColumn;
        readonly embedding: InlineEmbeddingColumn;
        readonly nullableEmbedding: NullableInlineEmbeddingColumn;
      };
      readonly primaryKey: { readonly columns: readonly ['id'] };
      readonly uniques: readonly [];
      readonly indexes: readonly [];
      readonly foreignKeys: readonly [];
    };
    readonly Named: {
      readonly columns: {
        readonly embedding: NamedEmbeddingColumn;
      };
      readonly primaryKey: { readonly columns: readonly [] };
      readonly uniques: readonly [];
      readonly indexes: readonly [];
      readonly foreignKeys: readonly [];
    };
  };
  readonly types: {
    readonly Vector1536: {
      readonly codecId: 'fixture/vector@1';
      readonly nativeType: 'vector(1536)';
      readonly typeParams: { readonly length: 1536 };
      readonly type: VectorFactory<1536>;
    };
  };
};

type FixtureModels = {
  readonly Inline: ContractModelBase & {
    readonly storage: {
      readonly table: 'Inline';
      readonly fields: {
        readonly id: { readonly column: 'id' };
        readonly embedding: { readonly column: 'embedding' };
        readonly nullableEmbedding: { readonly column: 'nullableEmbedding' };
      };
    };
  };
  readonly Named: ContractModelBase & {
    readonly storage: {
      readonly table: 'Named';
      readonly fields: {
        readonly embedding: { readonly column: 'embedding' };
      };
    };
  };
};

type FixtureContract = Contract<FixtureStorage, FixtureModels> & {
  readonly target: 'fixture-target';
  readonly targetFamily: 'sql';
  readonly profileHash: ProfileHashBase<'fixture'>;
} & {
  readonly [K in TypeMapsPhantomKey]?: TypeMaps<
    FixtureCodecTypes,
    Record<string, never>,
    Record<string, never>,
    FixtureFieldOutputTypes
  >;
};

// Inline parameterized column → resolved Js
export type _ComputeColumnJsType_InlineVector = Assert<
  IsEqual<
    ComputeColumnJsType<
      FixtureContract,
      'Inline',
      'embedding',
      InlineEmbeddingColumn,
      FixtureCodecTypes
    >,
    VectorN<1536>
  >
>;

// typeRef parameterized column → same resolved Js, via FieldOutputTypes lookup
export type _ComputeColumnJsType_TypeRefVector = Assert<
  IsEqual<
    ComputeColumnJsType<
      FixtureContract,
      'Named',
      'embedding',
      NamedEmbeddingColumn,
      FixtureCodecTypes
    >,
    VectorN<1536>
  >
>;

// Nullable inline parameterized column → Js | null
export type _ComputeColumnJsType_NullableInlineVector = Assert<
  IsEqual<
    ComputeColumnJsType<
      FixtureContract,
      'Inline',
      'nullableEmbedding',
      NullableInlineEmbeddingColumn,
      FixtureCodecTypes
    >,
    VectorN<1536> | null
  >
>;

// Non-parameterized column → codec base output preserved through delegation
export type _ComputeColumnJsType_NonParameterized = Assert<
  IsEqual<ComputeColumnJsType<FixtureContract, 'Inline', 'id', IdColumn, FixtureCodecTypes>, number>
>;
