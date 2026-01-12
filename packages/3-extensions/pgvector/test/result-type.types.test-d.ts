import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { SqlContract } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql } from '@prisma-next/sql-lane/sql';
import { param } from '@prisma-next/sql-relational-core/param';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { expectTypeOf, test } from 'vitest';
import pgvectorDescriptor from '../src/exports/runtime';
import type { CodecTypes, Vector } from '../src/types/codec-types';
import type { OperationTypes as PgVectorOperationTypes } from '../src/types/operation-types';

// Define contract types with vector columns
type ContractWithNullableVector = SqlContract<
  {
    readonly tables: {
      readonly post: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly title: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
          readonly embedding: {
            readonly nativeType: 'vector';
            readonly codecId: 'pg/vector@1';
            readonly nullable: true;
            readonly typeParams: { readonly length: 1536 };
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly never[];
        readonly indexes: readonly never[];
        readonly foreignKeys: readonly never[];
      };
    };
  },
  {
    readonly Post: {
      readonly storage: { readonly table: 'post' };
      readonly fields: {
        readonly id: number;
        readonly title: string;
        readonly embedding: Vector<1536> | null;
      };
    };
  },
  Record<string, never>,
  {
    readonly tableToModel: { readonly post: 'Post' };
    readonly columnToField: {
      readonly post: {
        readonly id: 'id';
        readonly title: 'title';
        readonly embedding: 'embedding';
      };
    };
    readonly codecTypes: {
      readonly 'pg/int4@1': { readonly output: number };
      readonly 'pg/text@1': { readonly output: string };
      readonly 'pg/vector@1': {
        readonly output: number[];
      };
    };
    readonly operationTypes: PgVectorOperationTypes;
  }
>;

type ContractWithNonNullableVector = SqlContract<
  {
    readonly tables: {
      readonly post: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly embedding: {
            readonly nativeType: 'vector';
            readonly codecId: 'pg/vector@1';
            readonly nullable: false;
            readonly typeParams: { readonly length: 1536 };
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly never[];
        readonly indexes: readonly never[];
        readonly foreignKeys: readonly never[];
      };
    };
  },
  {
    readonly Post: {
      readonly storage: { readonly table: 'post' };
      readonly fields: {
        readonly id: number;
        readonly embedding: Vector<1536>;
      };
    };
  },
  Record<string, never>,
  {
    readonly tableToModel: { readonly post: 'Post' };
    readonly columnToField: {
      readonly post: { readonly id: 'id'; readonly embedding: 'embedding' };
    };
    readonly codecTypes: {
      readonly 'pg/int4@1': { readonly output: number };
      readonly 'pg/vector@1': {
        readonly output: number[];
      };
    };
    readonly operationTypes: PgVectorOperationTypes;
  }
>;

test('ResultType infers Vector<1536> | null for parameterized nullable vector column', () => {
  const contractWithVector = validateContract<ContractWithNullableVector>({
    target: 'postgres',
    targetFamily: 'sql' as const,
    coreHash: 'sha256:test-core',
    profileHash: 'sha256:test-profile',
    storage: {
      tables: {
        post: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            embedding: {
              nativeType: 'vector',
              codecId: 'pg/vector@1',
              nullable: true,
              typeParams: { length: 1536 },
            },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    } as unknown as ContractWithNullableVector['mappings'],
  });

  const adapter = createPostgresAdapter();
  const context = createTestContext(contractWithVector, adapter, {
    extensionPacks: [pgvectorDescriptor],
  });
  const tables = schema(context).tables;
  const postTable = tables['post'];
  if (!postTable) throw new Error('post table not found');
  const postColumns = postTable.columns;

  const _plan = sql({ context })
    .from(postTable)
    .select({
      id: postColumns['id']!,
      title: postColumns['title']!,
      embedding: postColumns['embedding']!,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  // Type assertions via assignability (both directions), avoiding expectTypeOf equality API quirks.
  const embeddingValue = null as Row['embedding'];
  const embeddingAsExpected: Vector<1536> | null = embeddingValue;
  void embeddingAsExpected;
  const expectedEmbedding: Vector<1536> | null = null;
  const expectedEmbeddingAsActual: Row['embedding'] = expectedEmbedding;
  void expectedEmbeddingAsActual;

  const idValue = 0 as Row['id'];
  const idAsExpected: number = idValue;
  void idAsExpected;
  const expectedId: number = 0;
  const expectedIdAsActual: Row['id'] = expectedId;
  void expectedIdAsActual;

  const titleValue = '' as Row['title'];
  const titleAsExpected: string = titleValue;
  void titleAsExpected;
  const expectedTitle: string = '';
  const expectedTitleAsActual: Row['title'] = expectedTitle;
  void expectedTitleAsActual;

  // Verify the overall structure
  expectTypeOf({} as Row).toExtend<{
    id: number;
    title: string;
    embedding: Vector<1536> | null;
  }>();

  expectTypeOf(_plan).toExtend<SqlQueryPlan<Row>>();
});

test('ResultType infers Vector<1536> for parameterized non-nullable vector column', () => {
  const contractWithVector = validateContract<ContractWithNonNullableVector>({
    target: 'postgres',
    targetFamily: 'sql' as const,
    coreHash: 'sha256:test-core',
    profileHash: 'sha256:test-profile',
    storage: {
      tables: {
        post: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            embedding: {
              nativeType: 'vector',
              codecId: 'pg/vector@1',
              nullable: false,
              typeParams: { length: 1536 },
            },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    } as unknown as ContractWithNonNullableVector['mappings'],
  });

  const adapter = createPostgresAdapter();
  const context = createTestContext(contractWithVector, adapter, {
    extensionPacks: [pgvectorDescriptor],
  });
  const tables = schema(context).tables;
  const postTable = tables['post'];
  if (!postTable) throw new Error('post table not found');
  const postColumns = postTable.columns;

  const _plan = sql({ context })
    .from(postTable)
    .select({
      id: postColumns['id']!,
      embedding: postColumns['embedding']!,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  const embeddingValue = [] as Row['embedding'];
  const embeddingAsExpected: Vector<1536> = embeddingValue;
  void embeddingAsExpected;
  const expectedEmbedding: Vector<1536> = [];
  const expectedEmbeddingAsActual: Row['embedding'] = expectedEmbedding;
  void expectedEmbeddingAsActual;

  const idValue = 0 as Row['id'];
  const idAsExpected: number = idValue;
  void idAsExpected;
  const expectedId: number = 0;
  const expectedIdAsActual: Row['id'] = expectedId;
  void expectedIdAsActual;

  // Verify the overall structure
  expectTypeOf({} as Row).toExtend<{
    id: number;
    embedding: Vector<1536>;
  }>();

  expectTypeOf(_plan).toExtend<SqlQueryPlan<Row>>();
});

test('cosineDistance remains available on parameterized vector columns', () => {
  const contractWithVector = validateContract<ContractWithNonNullableVector>({
    target: 'postgres',
    targetFamily: 'sql' as const,
    coreHash: 'sha256:test-core',
    profileHash: 'sha256:test-profile',
    storage: {
      tables: {
        post: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            embedding: {
              nativeType: 'vector',
              codecId: 'pg/vector@1',
              nullable: false,
              typeParams: { length: 1536 },
            },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    } as unknown as ContractWithNonNullableVector['mappings'],
  });

  const adapter = createPostgresAdapter();
  const context = createTestContext(contractWithVector, adapter, {
    extensionPacks: [pgvectorDescriptor],
  });
  const tables = schema(context).tables;
  const postTable = tables['post'];
  if (!postTable) throw new Error('post table not found');
  const postColumns = postTable.columns;

  const _plan = sql({ context })
    .from(postTable)
    .select({
      distance: postColumns['embedding']!.cosineDistance(param('queryVector')),
    })
    .build({ params: { queryVector: [0, 1, 2] } });

  type Row = ResultType<typeof _plan>;
  const distanceValue = 0 as Row['distance'];
  const distanceAsExpected: number = distanceValue;
  void distanceAsExpected;
});

test('CodecTypes keeps scalar output as number[] and exposes parameterizedOutput', () => {
  // Verify that CodecTypes['pg/vector@1']['output'] is number[]
  type VectorCodecType = CodecTypes['pg/vector@1'];
  expectTypeOf({} as VectorCodecType).toHaveProperty('output');
  const outputValue = [] as VectorCodecType['output'];
  const outputAsExpected: number[] = outputValue;
  void outputAsExpected;
  const expectedOutput: number[] = [];
  const expectedOutputAsActual: VectorCodecType['output'] = expectedOutput;
  void expectedOutputAsActual;
});
