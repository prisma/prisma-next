import type { Contract, ProfileHashBase } from '@prisma-next/contract/types';
import type { SqlStorage, TypeMaps, TypeMapsPhantomKey } from '@prisma-next/sql-contract/types';
import type { ComputeColumnJsType } from '@prisma-next/sql-relational-core/types';

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<_T extends true> = never;

type TestCodecTypes = {
  readonly 'pg/vector@1': {
    readonly output: number[];
    readonly parameterizedOutput: (params: { readonly length: number }) => Float32Array;
  };
  readonly 'pg/int4@1': {
    readonly output: number;
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

type BaseContract = Contract<SqlStorage> & {
  readonly target: 'postgres';
  readonly targetFamily: 'sql';
  readonly roots: Record<string, never>;
  readonly models: Record<string, never>;
  readonly capabilities: Record<string, never>;
  readonly extensionPacks: Record<string, never>;
  readonly meta: Record<string, never>;
  readonly profileHash: ProfileHashBase<'test'>;
};

type ContractInlineTypeParams = BaseContract & {
  readonly storage: TestStorage;
} & { readonly [K in TypeMapsPhantomKey]?: TypeMaps<TestCodecTypes> };

type ContractTypeRef = BaseContract & {
  readonly storage: TestStorageWithTypeRef;
} & { readonly [K in TypeMapsPhantomKey]?: TypeMaps<TestCodecTypes> };

// ── Scenario 1: inline typeParams → parameterized output ─────────────────
// Column with typeParams: { length: 1536 } and codec pg/vector@1 with parameterizedOutput
// should resolve to Float32Array (the return type of parameterizedOutput).
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

// ── Scenario 2: typeRef → resolved typeParams → parameterized output ─────
// Column with typeRef: 'Embedding1536' pointing to storage.types should
// resolve the same way as inline typeParams.
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

// ── Scenario 3: no typeParams → base codec output ────────────────────────
// Column without typeParams or typeRef should fall back to base codec output.
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

type ContractNullable = BaseContract & {
  readonly storage: SqlStorage & {
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
  };
} & { readonly [K in TypeMapsPhantomKey]?: TypeMaps<TestCodecTypes> };

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
