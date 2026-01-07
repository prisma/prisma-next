import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParamDescriptor } from '@prisma-next/contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SelectAst as SelectAstType } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ColumnBuilder } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder.ts';
import type { CodecTypes, Contract } from './fixtures/contract.d.ts';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

describe('sql DSL builder', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;

  it('builds a select plan with projection, where, order, and limit', () => {
    const userColumns = tables.user.columns;

    const plan = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      .select({
        id: userColumns.id,
        email: userColumns.email,
      })
      .where(userColumns.id.eq(param('userId')))
      .orderBy(userColumns.createdAt.desc())
      .limit(5)
      .build({ params: { userId: 42 } });

    expect(plan.ast).toMatchObject({
      kind: 'select',
      from: { name: 'user' },
      project: [
        { alias: 'id', expr: createColumnRef('user', 'id') },
        { alias: 'email', expr: createColumnRef('user', 'email') },
      ],
      where: {
        left: { table: 'user', column: 'id' },
        right: { index: 1, name: 'userId' },
      },
      orderBy: [
        {
          expr: { table: 'user', column: 'createdAt' },
          dir: 'desc',
        },
      ],
      limit: 5,
    });

    expect(plan.params).toEqual([42]);
    expect(plan.meta).toMatchObject({
      target: 'postgres',
      coreHash: contract.coreHash,
      lane: 'dsl',
      refs: {
        tables: ['user'],
        columns: expect.arrayContaining([
          { table: 'user', column: 'id' },
          { table: 'user', column: 'email' },
          { table: 'user', column: 'createdAt' },
        ]),
      },
      projection: {
        id: 'user.id',
        email: 'user.email',
      },
    });

    expect(plan.meta.paramDescriptors).toEqual<ParamDescriptor[]>([
      {
        name: 'userId',
        codecId: 'pg/int4@1',
        nativeType: 'int4',
        nullable: false,
        source: 'dsl',
        refs: { table: 'user', column: 'id' },
      },
    ]);
  });

  it('throws PLAN.INVALID when selecting an invalid column', () => {
    const builder = sql<Contract, CodecTypes>({ context }).from(tables.user);

    // Invalid: passing something that's not a ColumnBuilder or nested object
    expect(() => builder.select({ invalid: null as unknown as ColumnBuilder })).toThrowError(
      /Invalid projection value/,
    );
  });

  it('throws PLAN.INVALID when parameter value is missing', () => {
    const userColumns = tables.user.columns;

    const builder = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      .select({
        id: userColumns.id,
      })
      .where(userColumns.id.eq(param('userId')));

    expect(() => builder.build()).toThrowError(/Missing value for parameter userId/);
  });

  describe('codec assignments', () => {
    it('encodes codec assignments from extension decorations for projections', () => {
      const contractWithCodecs = {
        ...contract,
        extensionPacks: {
          postgres: {
            decorations: {
              columns: [
                {
                  ref: { kind: 'column', table: 'user', column: 'id' },
                  payload: { typeId: 'pg/int4@1' },
                },
                {
                  ref: { kind: 'column', table: 'user', column: 'email' },
                  payload: { typeId: 'pg/text@1' },
                },
              ],
            },
          },
        },
      };

      const contractValidated = validateContract<Contract>(contractWithCodecs);
      const contextWithCodecs = createTestContext(contractValidated, adapter);
      const userColumns = schema<Contract>(contextWithCodecs).tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ context: contextWithCodecs })
        .from(schema<Contract>(contextWithCodecs).tables.user)
        .select({
          id: userColumns.id,
          email: userColumns.email,
        })
        .build();

      expect(plan.meta.annotations).toBeDefined();
      expect(plan.meta.annotations?.codecs).toEqual({
        id: 'pg/int4@1',
        email: 'pg/text@1',
      });
    });

    it('encodes codec assignments from column types for WHERE parameters', () => {
      const contractValidated = validateContract<Contract>(contract);
      const contextValidated = createTestContext(contractValidated, adapter);
      const userColumns = schema<Contract>(contextValidated).tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ context: contextValidated })
        .from(schema<Contract>(contextValidated).tables.user)
        .select({
          email: userColumns.email,
        })
        .where(userColumns.id.eq(param('userId')))
        .build({ params: { userId: 42 } });

      expect(plan.meta.annotations).toBeDefined();
      expect(plan.meta.annotations?.codecs).toEqual({
        email: 'pg/text@1',
        userId: 'pg/int4@1',
      });
    });

    it('merges projection and parameter codec assignments', () => {
      const contractWithCodecs = {
        ...contract,
        extensionPacks: {
          postgres: {
            decorations: {
              columns: [
                {
                  ref: { kind: 'column', table: 'user', column: 'id' },
                  payload: { typeId: 'pg/int4@1' },
                },
                {
                  ref: { kind: 'column', table: 'user', column: 'email' },
                  payload: { typeId: 'pg/text@1' },
                },
              ],
            },
          },
        },
      };

      const contractValidated = validateContract<Contract>(contractWithCodecs);
      const contextWithCodecs = createTestContext(contractValidated, adapter);
      const userColumns = schema<Contract>(contextWithCodecs).tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ context: contextWithCodecs })
        .from(schema<Contract>(contextWithCodecs).tables.user)
        .select({
          id: userColumns.id,
          email: userColumns.email,
        })
        .where(userColumns.id.eq(param('userId')))
        .build({ params: { userId: 42 } });

      expect(plan.meta.annotations).toBeDefined();
      expect(plan.meta.annotations?.codecs).toEqual({
        id: 'pg/int4@1',
        email: 'pg/text@1',
        userId: 'pg/int4@1',
      });
    });

    it('includes codec annotations from column types', () => {
      // Contract fixture has column types as pg/*@1 IDs
      const userColumns = tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .select({
          id: userColumns.id,
          email: userColumns.email,
        })
        .build();

      expect(plan.meta.annotations).toBeDefined();
      expect(plan.meta.annotations?.codecs).toEqual({
        id: 'pg/int4@1',
        email: 'pg/text@1',
      });
    });
  });

  describe('nested projections', () => {
    it('flattens single-level nested projection', () => {
      const userColumns = tables.user.columns;

      const plan = sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .select({
          name: userColumns.email,
          post: {
            title: userColumns.id,
          },
        })
        .build();

      expect((plan.ast as SelectAstType | undefined)?.project).toEqual([
        { alias: 'name', expr: createColumnRef('user', 'email') },
        { alias: 'post_title', expr: createColumnRef('user', 'id') },
      ]);

      expect(plan.meta.projection).toEqual({
        name: 'user.email',
        post_title: 'user.id',
      });
    });

    it('flattens multi-level nested projection', () => {
      const userColumns = tables.user.columns;

      const plan = sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .select({
          a: {
            b: {
              c: userColumns.id,
            },
          },
        })
        .build();

      expect((plan.ast as SelectAstType | undefined)?.project).toEqual([
        { alias: 'a_b_c', expr: createColumnRef('user', 'id') },
      ]);

      expect(plan.meta.projection).toEqual({
        a_b_c: 'user.id',
      });
    });

    it('handles mixed leaves and nested objects', () => {
      const userColumns = tables.user.columns;

      const plan = sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .select({
          id: userColumns.id,
          post: {
            title: userColumns.email,
            author: {
              name: userColumns.id,
            },
          },
          email: userColumns.email,
        })
        .build();

      expect((plan.ast as SelectAstType | undefined)?.project).toEqual([
        { alias: 'id', expr: createColumnRef('user', 'id') },
        { alias: 'post_title', expr: createColumnRef('user', 'email') },
        { alias: 'post_author_name', expr: createColumnRef('user', 'id') },
        { alias: 'email', expr: createColumnRef('user', 'email') },
      ]);

      expect(plan.meta.projection).toEqual({
        id: 'user.id',
        post_title: 'user.email',
        post_author_name: 'user.id',
        email: 'user.email',
      });
    });

    it('throws PLAN.INVALID on alias collision', () => {
      const userColumns = tables.user.columns;

      const builder = sql<Contract, CodecTypes>({ context }).from(tables.user);

      expect(() =>
        builder.select({
          a_b: userColumns.id,
          a: {
            b: userColumns.email,
          },
        }),
      ).toThrowError(/Alias collision/);
    });

    it('includes projectionTypes for nested projections', () => {
      const userColumns = tables.user.columns;

      const plan = sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .select({
          name: userColumns.email,
          post: {
            title: userColumns.id,
          },
        })
        .build();

      expect(plan.meta.projectionTypes).toEqual({
        name: 'pg/text@1',
        post_title: 'pg/int4@1',
      });
    });

    it('includes codec annotations for nested projections', () => {
      const userColumns = tables.user.columns;

      const plan = sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .select({
          name: userColumns.email,
          post: {
            title: userColumns.id,
          },
        })
        .build();

      expect(plan.meta.annotations?.codecs).toEqual({
        name: 'pg/text@1',
        post_title: 'pg/int4@1',
      });
    });
  });

  it('schema table proxy allows direct column access', () => {
    const contract = loadContract('contract');
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const schemaHandle = schema(context);
    const userTable = schemaHandle.tables.user;

    // Access column directly on table (via proxy)
    const idColumn = (userTable as unknown as { id: unknown }).id;
    expect(idColumn).toBeDefined();
    expect((idColumn as { kind: string }).kind).toBe('column');

    // Access non-existent property returns undefined
    const invalidColumn = (userTable as unknown as { invalidColumn: unknown }).invalidColumn;
    expect(invalidColumn).toBeUndefined();

    // Access table properties (name, kind, columns) works
    expect(userTable.name).toBe('user');
    expect(userTable.kind).toBe('table');
    expect(userTable.columns).toBeDefined();
  });

  it('handles column builder __jsType getter', () => {
    const contract = loadContract('contract');
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const idColumn = tables.user.columns.id;

    // Access __jsType getter (type-level helper, returns undefined at runtime)
    const jsType = (idColumn as { __jsType: unknown }).__jsType;
    expect(jsType).toBeUndefined();
  });
});
