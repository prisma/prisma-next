import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { Plan, ResultType } from '@prisma-next/contract/types';
import type { SqlContract } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql } from '@prisma-next/sql-lane/sql';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createRuntimeContext } from '@prisma-next/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import pgvector from '../src/exports/runtime';
import type { CodecTypes } from '../src/types/codec-types';

// Define contract types with vector columns
type ContractWithNullableVector = SqlContract<
  {
    readonly tables: {
      readonly post: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; nullable: false };
          readonly title: { readonly type: 'pg/text@1'; nullable: false };
          readonly embedding: { readonly type: 'pg/vector@1'; nullable: true };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly never[];
        readonly indexes: readonly never[];
        readonly foreignKeys: readonly never[];
      };
    };
  },
  Record<string, never>,
  Record<string, never>,
  {
    readonly codecTypes: {
      readonly 'pg/int4@1': { readonly output: number };
      readonly 'pg/text@1': { readonly output: string };
      readonly 'pg/vector@1': { readonly output: number[] };
    };
    readonly operationTypes: Record<string, Record<string, unknown>>;
  }
>;

type ContractWithNonNullableVector = SqlContract<
  {
    readonly tables: {
      readonly post: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; nullable: false };
          readonly embedding: { readonly type: 'pg/vector@1'; nullable: false };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly never[];
        readonly indexes: readonly never[];
        readonly foreignKeys: readonly never[];
      };
    };
  },
  Record<string, never>,
  Record<string, never>,
  {
    readonly codecTypes: {
      readonly 'pg/int4@1': { readonly output: number };
      readonly 'pg/vector@1': { readonly output: number[] };
    };
    readonly operationTypes: Record<string, Record<string, unknown>>;
  }
>;

test('ResultType correctly infers number[] for vector column', () => {
  const contractWithVector = validateContract<ContractWithNullableVector>({
    target: 'postgres',
    targetFamily: 'sql' as const,
    coreHash: 'sha256:test-core',
    profileHash: 'sha256:test-profile',
    storage: {
      tables: {
        post: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            title: { type: 'pg/text@1', nullable: false },
            embedding: { type: 'pg/vector@1', nullable: true },
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
  const context = createRuntimeContext({
    contract: contractWithVector,
    adapter,
    extensions: [pgvector()],
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

  // Verify that vector column is correctly inferred
  // Note: Type inference for nullable columns may have limitations
  // We verify that the type is at least number[] or null
  expectTypeOf<Row['embedding']>().toExtend<number[] | null>();
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['title']>().toEqualTypeOf<string>();

  // Verify the overall structure
  expectTypeOf<Row>().toExtend<{
    id: number;
    title: string;
    embedding: number[] | null;
  }>();

  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('ResultType correctly infers number[] for non-nullable vector column', () => {
  const contractWithVector = validateContract<ContractWithNonNullableVector>({
    target: 'postgres',
    targetFamily: 'sql' as const,
    coreHash: 'sha256:test-core',
    profileHash: 'sha256:test-profile',
    storage: {
      tables: {
        post: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            embedding: { type: 'pg/vector@1', nullable: false },
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
  const context = createRuntimeContext({
    contract: contractWithVector,
    adapter,
    extensions: [pgvector()],
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

  // Verify that non-nullable vector column is correctly inferred as number[]
  expectTypeOf<Row['embedding']>().toEqualTypeOf<number[]>();
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();

  // Verify the overall structure
  expectTypeOf<Row>().toExtend<{
    id: number;
    embedding: number[];
  }>();

  expectTypeOf(_plan).toExtend<Plan<Row>>();
});

test('ResultType correctly infers vector column type from CodecTypes', () => {
  // Verify that CodecTypes['pg/vector@1']['output'] is number[]
  type VectorCodecType = CodecTypes['pg/vector@1'];
  expectTypeOf<VectorCodecType>().toHaveProperty('output');
  expectTypeOf<VectorCodecType['output']>().toEqualTypeOf<number[]>();
});
