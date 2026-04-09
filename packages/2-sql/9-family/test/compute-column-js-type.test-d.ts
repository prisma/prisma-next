import type { Contract, ContractModelBase, ProfileHashBase } from '@prisma-next/contract/types';
import type { SqlStorage, TypeMaps, TypeMapsPhantomKey } from '@prisma-next/sql-contract/types';
import type { ComputeColumnJsType } from '@prisma-next/sql-relational-core/types';

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<_T extends true> = never;

type TestCodecTypes = {
  readonly 'pg/vector@1': {
    readonly output: number[];
  };
  readonly 'pg/int4@1': {
    readonly output: number;
  };
};

type TestFieldOutputTypes = {
  readonly Vectors: {
    readonly id: number;
    readonly embedding: Float32Array;
  };
};

type TestStorage = SqlStorage & {
  readonly tables: {
    readonly vectors: {
      readonly columns: {
        readonly id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: false;
        };
        readonly embedding: {
          readonly nativeType: 'vector(1536)';
          readonly codecId: 'pg/vector@1';
          readonly nullable: false;
          readonly typeParams: { readonly length: 1536 };
        };
      };
      readonly primaryKey: { readonly columns: readonly ['id'] };
      readonly uniques: readonly [];
      readonly indexes: readonly [];
      readonly foreignKeys: readonly [];
    };
  };
  readonly types: {
    readonly Embedding1536: {
      readonly codecId: 'pg/vector@1';
      readonly nativeType: 'vector(1536)';
      readonly typeParams: { readonly length: 1536 };
    };
  };
};

type TestStorageWithTypeRef = SqlStorage & {
  readonly tables: {
    readonly vectors: {
      readonly columns: {
        readonly embedding: {
          readonly nativeType: 'vector(1536)';
          readonly codecId: 'pg/vector@1';
          readonly nullable: false;
          readonly typeRef: 'Embedding1536';
        };
      };
      readonly primaryKey: { readonly columns: readonly [] };
      readonly uniques: readonly [];
      readonly indexes: readonly [];
      readonly foreignKeys: readonly [];
    };
  };
  readonly types: {
    readonly Embedding1536: {
      readonly codecId: 'pg/vector@1';
      readonly nativeType: 'vector(1536)';
      readonly typeParams: { readonly length: 1536 };
    };
  };
};

type VectorsModel = ContractModelBase & {
  readonly storage: {
    readonly table: 'vectors';
    readonly fields: {
      readonly id: { readonly column: 'id' };
      readonly embedding: { readonly column: 'embedding' };
    };
  };
};

type TestModels = {
  readonly Vectors: VectorsModel;
};

type TestTypeMaps = TypeMaps<
  TestCodecTypes,
  Record<string, never>,
  Record<string, never>,
  TestFieldOutputTypes
>;

type ContractInlineTypeParams = Contract<TestStorage, TestModels> & {
  readonly target: 'postgres';
  readonly targetFamily: 'sql';
  readonly profileHash: ProfileHashBase<'test'>;
} & { readonly [K in TypeMapsPhantomKey]?: TestTypeMaps };

type ContractTypeRef = Contract<TestStorageWithTypeRef, TestModels> & {
  readonly target: 'postgres';
  readonly targetFamily: 'sql';
  readonly profileHash: ProfileHashBase<'test'>;
} & { readonly [K in TypeMapsPhantomKey]?: TestTypeMaps };

// ── Scenario 1: FieldOutputTypes lookup resolves parameterized output ────
export type _InlineTypeParams = Assert<
  IsEqual<
    ComputeColumnJsType<
      ContractInlineTypeParams,
      'vectors',
      'embedding',
      TestStorage['tables']['vectors']['columns']['embedding'],
      TestCodecTypes
    >,
    Float32Array
  >
>;

// ── Scenario 2: typeRef column resolves via FieldOutputTypes ─────────────
export type _TypeRefResolved = Assert<
  IsEqual<
    ComputeColumnJsType<
      ContractTypeRef,
      'vectors',
      'embedding',
      TestStorageWithTypeRef['tables']['vectors']['columns']['embedding'],
      TestCodecTypes
    >,
    Float32Array
  >
>;

// ── Scenario 3: no typeParams → base codec output from FieldOutputTypes ──
export type _BaseCodecFallback = Assert<
  IsEqual<
    ComputeColumnJsType<
      ContractInlineTypeParams,
      'vectors',
      'id',
      TestStorage['tables']['vectors']['columns']['id'],
      TestCodecTypes
    >,
    number
  >
>;

// ── Scenario 4: nullable + typeParams → parameterized output | null ──────
type NullableVectorColumn = {
  readonly nativeType: 'vector(1536)';
  readonly codecId: 'pg/vector@1';
  readonly nullable: true;
  readonly typeParams: { readonly length: 1536 };
};

type NullableFieldOutputTypes = {
  readonly Vectors: {
    readonly embedding: Float32Array | null;
  };
};

type NullableVectorsModel = ContractModelBase & {
  readonly storage: {
    readonly table: 'vectors';
    readonly fields: {
      readonly embedding: { readonly column: 'embedding' };
    };
  };
};

type ContractNullable = Contract<
  SqlStorage & {
    readonly tables: {
      readonly vectors: {
        readonly columns: {
          readonly embedding: NullableVectorColumn;
        };
        readonly primaryKey: { readonly columns: readonly [] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
    };
  },
  { readonly Vectors: NullableVectorsModel }
> & {
  readonly target: 'postgres';
  readonly targetFamily: 'sql';
  readonly profileHash: ProfileHashBase<'test'>;
} & {
  readonly [K in TypeMapsPhantomKey]?: TypeMaps<
    TestCodecTypes,
    Record<string, never>,
    Record<string, never>,
    NullableFieldOutputTypes
  >;
};

export type _NullableTypeParams = Assert<
  IsEqual<
    ComputeColumnJsType<
      ContractNullable,
      'vectors',
      'embedding',
      NullableVectorColumn,
      TestCodecTypes
    >,
    Float32Array | null
  >
>;
