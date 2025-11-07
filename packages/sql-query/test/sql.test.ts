import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../src/contract';
import { param } from '../src/param';
import { schema } from '../src/schema';
import { sql } from '../src/sql';
import type {
  Adapter,
  ColumnBuilder,
  LoweredStatement,
  ParamDescriptor,
  SelectAst,
} from '../src/types';
import type { SelectAst as SelectAstType } from '@prisma-next/sql-target';
import type { CodecTypes, Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(ast: SelectAst, ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

describe('sql DSL builder', () => {
  const contract = loadContract('contract');
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const adapter = createStubAdapter();

  it('builds a select plan with projection, where, order, and limit', () => {
    const userColumns = tables.user.columns;

    const plan = sql<Contract, CodecTypes>({ contract, adapter })
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
        { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
        { alias: 'email', expr: { kind: 'col', table: 'user', column: 'email' } },
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
        type: 'pg/int4@1',
        nullable: false,
        source: 'dsl',
        refs: { table: 'user', column: 'id' },
      },
    ]);
  });

  it('throws PLAN.INVALID when selecting an invalid column', () => {
    const builder = sql<Contract, CodecTypes>({
      contract,
      adapter,
      codecTypes: {} as CodecTypes,
    }).from(tables.user);

    // Invalid: passing something that's not a ColumnBuilder or nested object
    expect(() => builder.select({ invalid: null as unknown as ColumnBuilder })).toThrowError(
      /Invalid projection value/,
    );
  });

  it('throws PLAN.INVALID when parameter value is missing', () => {
    const userColumns = tables.user.columns;

    const builder = sql<Contract, CodecTypes>({ contract, adapter, codecTypes: {} as CodecTypes })
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
        extensions: {
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
      const userColumns = schema<Contract, CodecTypes>(contractValidated).tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ contract: contractValidated, adapter })
        .from(schema<Contract, CodecTypes>(contractValidated).tables.user)
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
      const userColumns = schema<Contract, CodecTypes>(contractValidated).tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ contract: contractValidated, adapter })
        .from(schema<Contract, CodecTypes>(contractValidated).tables.user)
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
        extensions: {
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
      const userColumns = schema<Contract, CodecTypes>(contractValidated).tables.user.columns;
      const plan = sql<Contract, CodecTypes>({ contract: contractValidated, adapter })
        .from(schema<Contract, CodecTypes>(contractValidated).tables.user)
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
      const plan = sql<Contract, CodecTypes>({ contract, adapter })
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

      const plan = sql<Contract, CodecTypes>({ contract, adapter })
        .from(tables.user)
        .select({
          name: userColumns.email,
          post: {
            title: userColumns.id,
          },
        })
        .build();

      expect((plan.ast as SelectAstType | undefined)?.project).toEqual([
        { alias: 'name', expr: { kind: 'col', table: 'user', column: 'email' } },
        { alias: 'post_title', expr: { kind: 'col', table: 'user', column: 'id' } },
      ]);

      expect(plan.meta.projection).toEqual({
        name: 'user.email',
        post_title: 'user.id',
      });
    });

    it('flattens multi-level nested projection', () => {
      const userColumns = tables.user.columns;

      const plan = sql<Contract, CodecTypes>({ contract, adapter })
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
        { alias: 'a_b_c', expr: { kind: 'col', table: 'user', column: 'id' } },
      ]);

      expect(plan.meta.projection).toEqual({
        a_b_c: 'user.id',
      });
    });

    it('handles mixed leaves and nested objects', () => {
      const userColumns = tables.user.columns;

      const plan = sql<Contract, CodecTypes>({ contract, adapter })
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
        { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
        { alias: 'post_title', expr: { kind: 'col', table: 'user', column: 'email' } },
        { alias: 'post_author_name', expr: { kind: 'col', table: 'user', column: 'id' } },
        { alias: 'email', expr: { kind: 'col', table: 'user', column: 'email' } },
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

      const builder = sql<Contract, CodecTypes>({ contract, adapter }).from(tables.user);

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

      const plan = sql<Contract, CodecTypes>({ contract, adapter })
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

      const plan = sql<Contract, CodecTypes>({ contract, adapter })
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
});
