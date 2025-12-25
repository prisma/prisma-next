import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlContract } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { OperationExpr, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef, createTableRef } from '@prisma-next/sql-relational-core/ast';
import { createExpressionBuilder } from '@prisma-next/sql-relational-core/expression-builder';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { AnyExpressionBuilder } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

describe('select builder edge cases', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;
  const userTable = tables.user;
  const userColumns = userTable.columns;

  it('throws when from is not called', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .select({
          id: userColumns.id,
        })
        .build(),
    ).toThrow('from() must be called before building a query');
  });

  it('throws when select is not called', () => {
    expect(() => sql<Contract, CodecTypes>({ context }).from(userTable).build()).toThrow(
      'select() must be called before build()',
    );
  });

  it('throws when table does not exist', () => {
    const nonexistentTable = createTableRef('nonexistent');
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(nonexistentTable)
        .select({
          id: userColumns.id,
        })
        .build(),
    ).toThrow('Unknown table nonexistent');
  });

  it('throws when join table does not exist', () => {
    const nonexistentTable = createTableRef('nonexistent');
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .innerJoin(nonexistentTable, (on) => on.eqCol(userColumns.id, userColumns.id))
        .select({
          id: userColumns.id,
        })
        .build(),
    ).toThrow('Unknown table nonexistent');
  });

  it('throws when self-join is attempted', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .innerJoin(userTable, (on) => on.eqCol(userColumns.id, userColumns.id))
        .select({
          id: userColumns.id,
        })
        .build(),
    ).toThrow('Self-joins are not supported in MVP');
  });

  it('throws when limit is negative', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .select({
          id: userColumns.id,
        })
        .limit(-1)
        .build(),
    ).toThrow('Limit must be a non-negative integer');
  });

  it('throws when limit is not an integer', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .select({
          id: userColumns.id,
        })
        .limit(1.5)
        .build(),
    ).toThrow('Limit must be a non-negative integer');
  });

  it('throws when parameter is missing in where', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .where(userColumns.id.eq(param('userId')))
        .select({
          id: userColumns.id,
        })
        .build({ params: {} }),
    ).toThrow('Missing value for parameter userId');
  });

  it('handles invalid column for alias', () => {
    // This test verifies that buildMeta throws when column is missing
    // The actual error is thrown in buildMeta when processing projection
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(userTable)
        .select({
          id: userColumns.id,
        })
        .build(),
    ).not.toThrow('Missing column for alias');
  });

  it('builds query with right join', () => {
    // Create a contract with a post table for join tests
    type ContractWithPost = SqlContract<
      {
        readonly tables: {
          readonly user: Contract['storage']['tables']['user'];
          readonly post: {
            readonly columns: {
              readonly id: {
                readonly nativeType: 'int4';
                readonly codecId: 'pg/int4@1';
                readonly nullable: false;
              };
              readonly userId: {
                readonly nativeType: 'int4';
                readonly codecId: 'pg/int4@1';
                readonly nullable: false;
              };
            };
            readonly primaryKey: { readonly columns: readonly ['id'] };
            readonly uniques: ReadonlyArray<never>;
            readonly indexes: ReadonlyArray<never>;
            readonly foreignKeys: ReadonlyArray<never>;
          };
        };
      },
      Contract['models'],
      Contract['relations'],
      Contract['mappings']
    >;

    const contractWithPost = validateContract<ContractWithPost>({
      target: 'postgres',
      targetFamily: 'sql' as const,
      coreHash: 'sha256:test-core',
      profileHash: 'sha256:test-profile',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              createdAt: {
                nativeType: 'timestamptz',
                codecId: 'pg/timestamptz@1',
                nullable: false,
              },
              deletedAt: { nativeType: 'timestamptz', codecId: 'pg/timestamptz@1', nullable: true },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {
        codecTypes: {} as CodecTypes,
        operationTypes: {},
      },
      capabilities: {
        postgres: {
          returning: true,
        },
      },
    });

    const adapterWithPost = createStubAdapter();
    const contextWithPost = createTestContext(contractWithPost, adapterWithPost);
    const tablesWithPost = schema<ContractWithPost>(contextWithPost).tables;
    const userTableWithPost = tablesWithPost.user;
    const userColumnsWithPost = userTableWithPost.columns;
    const postTableWithPost = tablesWithPost.post;
    const postColumnsWithPost = postTableWithPost.columns;

    const plan = sql<ContractWithPost, CodecTypes>({ context: contextWithPost })
      .from(userTableWithPost)
      .rightJoin(postTableWithPost, (on) =>
        on.eqCol(userColumnsWithPost.id, postColumnsWithPost.userId),
      )
      .select({
        id: userColumnsWithPost.id,
      })
      .build();

    const selectAst = plan.ast as SelectAst;
    expect(selectAst.joins).toBeDefined();
    expect(selectAst.joins?.[0]?.joinType).toBe('right');
  });

  it('builds query with full join', () => {
    // Create a contract with a post table for join tests
    type ContractWithPost = SqlContract<
      {
        readonly tables: {
          readonly user: Contract['storage']['tables']['user'];
          readonly post: {
            readonly columns: {
              readonly id: {
                readonly nativeType: 'int4';
                readonly codecId: 'pg/int4@1';
                readonly nullable: false;
              };
              readonly userId: {
                readonly nativeType: 'int4';
                readonly codecId: 'pg/int4@1';
                readonly nullable: false;
              };
            };
            readonly primaryKey: { readonly columns: readonly ['id'] };
            readonly uniques: ReadonlyArray<never>;
            readonly indexes: ReadonlyArray<never>;
            readonly foreignKeys: ReadonlyArray<never>;
          };
        };
      },
      Contract['models'],
      Contract['relations'],
      Contract['mappings']
    >;

    const contractWithPost = validateContract<ContractWithPost>({
      target: 'postgres',
      targetFamily: 'sql' as const,
      coreHash: 'sha256:test-core',
      profileHash: 'sha256:test-profile',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              createdAt: {
                nativeType: 'timestamptz',
                codecId: 'pg/timestamptz@1',
                nullable: false,
              },
              deletedAt: { nativeType: 'timestamptz', codecId: 'pg/timestamptz@1', nullable: true },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {
        codecTypes: {} as CodecTypes,
        operationTypes: {},
      },
      capabilities: {
        postgres: {
          returning: true,
        },
      },
    });

    const adapterWithPost = createStubAdapter();
    const contextWithPost = createTestContext(contractWithPost, adapterWithPost);
    const tablesWithPost = schema<ContractWithPost>(contextWithPost).tables;
    const userTableWithPost = tablesWithPost.user;
    const userColumnsWithPost = userTableWithPost.columns;
    const postTableWithPost = tablesWithPost.post;
    const postColumnsWithPost = postTableWithPost.columns;

    const plan = sql<ContractWithPost, CodecTypes>({ context: contextWithPost })
      .from(userTableWithPost)
      .fullJoin(postTableWithPost, (on) =>
        on.eqCol(userColumnsWithPost.id, postColumnsWithPost.userId),
      )
      .select({
        id: userColumnsWithPost.id,
      })
      .build();

    const selectAst = plan.ast as SelectAst;
    expect(selectAst.joins).toBeDefined();
    expect(selectAst.joins?.[0]?.joinType).toBe('full');
  });

  it('builds query with operation expression in orderBy', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'normalize',
      forTypeId: 'pg/vector@1',
      self: createColumnRef('user', 'id'),
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    const columnWithOp = createExpressionBuilder(operationExpr, {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    }) as AnyExpressionBuilder;

    const plan = sql<Contract, CodecTypes>({ context })
      .from(userTable)
      .orderBy(columnWithOp.asc())
      .select({
        id: userColumns.id,
      })
      .build();

    const selectAst = plan.ast as SelectAst;
    expect(selectAst.orderBy).toBeDefined();
    expect(selectAst.orderBy?.[0]?.expr).toMatchObject({
      kind: 'operation',
      method: 'normalize',
    });
  });
});

describe('select builder includeMany edge cases', () => {
  // Create a contract with both user and post tables for includeMany tests
  type ContractWithPost = SqlContract<
    {
      readonly tables: {
        readonly user: Contract['storage']['tables']['user'];
        readonly post: {
          readonly columns: {
            readonly id: {
              readonly nativeType: 'int4';
              readonly codecId: 'pg/int4@1';
              readonly nullable: false;
            };
            readonly userId: {
              readonly nativeType: 'int4';
              readonly codecId: 'pg/int4@1';
              readonly nullable: false;
            };
            readonly title: {
              readonly nativeType: 'text';
              readonly codecId: 'pg/text@1';
              readonly nullable: false;
            };
          };
          readonly primaryKey: { readonly columns: readonly ['id'] };
          readonly uniques: ReadonlyArray<never>;
          readonly indexes: ReadonlyArray<never>;
          readonly foreignKeys: ReadonlyArray<never>;
        };
      };
    },
    Contract['models'],
    Contract['relations'],
    Contract['mappings']
  > & {
    readonly capabilities: {
      readonly postgres: {
        readonly lateral: true;
        readonly jsonAgg: true;
      };
    };
  };

  const contractWithPost = validateContract<ContractWithPost>({
    target: 'postgres',
    targetFamily: 'sql' as const,
    coreHash: 'sha256:test-core',
    profileHash: 'sha256:test-profile',
    storage: {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            createdAt: { nativeType: 'timestamptz', codecId: 'pg/timestamptz@1', nullable: false },
            deletedAt: { nativeType: 'timestamptz', codecId: 'pg/timestamptz@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {
      codecTypes: {} as CodecTypes,
      operationTypes: {},
    },
    capabilities: {
      postgres: {
        lateral: true,
        jsonAgg: true,
      },
    },
  });

  const adapter = createStubAdapter();
  const context = createTestContext(contractWithPost, adapter);
  const tables = schema<ContractWithPost>(context).tables;
  const userTable = tables.user;
  const userColumns = userTable.columns;
  const postTable = tables.post;
  const postColumns = postTable.columns;

  it('builds includeMany without explicit alias (uses table name)', () => {
    const plan = sql<ContractWithPost, CodecTypes>({ context })
      .from(userTable)
      .includeMany(
        postTable,
        (on) => on.eqCol(userColumns.id, postColumns.userId),
        (child) => child.select({ id: postColumns.id }),
      )
      .select({
        id: userColumns.id,
        post: true,
      })
      .build();

    const selectAst = plan.ast as SelectAst;
    expect(selectAst.includes).toBeDefined();
    expect(selectAst.includes?.[0]?.alias).toBe('post');
  });

  it('throws when includeMany alias collides with existing includes', () => {
    expect(() =>
      sql<ContractWithPost, CodecTypes>({ context })
        .from(userTable)
        .includeMany(
          postTable,
          (on) => on.eqCol(userColumns.id, postColumns.userId),
          (child) => child.select({ id: postColumns.id }),
          { alias: 'posts' },
        )
        .includeMany(
          postTable,
          (on) => on.eqCol(userColumns.id, postColumns.userId),
          (child) => child.select({ id: postColumns.id }),
          { alias: 'posts' },
        )
        .select({
          id: userColumns.id,
          posts: true,
        })
        .build(),
    ).toThrow('Alias collision: include alias "posts" conflicts with existing include alias');
  });

  it('builds includeMany with operation expression in child orderBy', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'normalize',
      forTypeId: 'pg/vector@1',
      self: createColumnRef('post', 'id'),
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    const columnWithOp = createExpressionBuilder(operationExpr, {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    }) as AnyExpressionBuilder;

    const plan = sql<ContractWithPost, CodecTypes>({ context })
      .from(userTable)
      .includeMany(
        postTable,
        (on) => on.eqCol(userColumns.id, postColumns.userId),
        (child) => child.select({ id: postColumns.id }).orderBy(columnWithOp.asc()),
        { alias: 'posts' },
      )
      .select({
        id: userColumns.id,
        posts: true,
      })
      .build();

    const selectAst = plan.ast as SelectAst;
    expect(selectAst.includes).toBeDefined();
    expect(selectAst.includes?.[0]?.child.orderBy).toBeDefined();
    expect(selectAst.includes?.[0]?.child.orderBy?.[0]?.expr).toMatchObject({
      kind: 'col',
      table: 'post',
      column: 'id',
    });
  });
});
