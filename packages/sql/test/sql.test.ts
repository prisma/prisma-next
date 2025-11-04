import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { param } from '../src/param';
import { schema } from '../src/schema';
import { sql } from '../src/sql';
import { validateContract } from '../src/contract';
import type { SqlContract, SqlStorage } from '../src/contract-types';
import type {
  ParamDescriptor,
  Adapter,
  LoweredStatement,
  SelectAst,
  ColumnBuilder,
} from '../src/types';
import { CodecRegistry } from '@prisma-next/sql-target';
import type { Contract, CodecTypes } from './fixtures/contract.d';

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
        return new CodecRegistry();
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
        type: 'int4',
        nullable: false,
        source: 'dsl',
        refs: { table: 'user', column: 'id' },
      },
    ]);
  });

  it('throws PLAN.INVALID when selecting an invalid column', () => {
    const builder = sql<Contract, CodecTypes>({ contract, adapter, codecTypes: {} as CodecTypes }).from(tables.user);

    // Invalid: passing something that's not a ColumnBuilder
    expect(() => builder.select({ invalid: {} as unknown as ColumnBuilder })).toThrowError(
      /Invalid column projection/,
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

    it('encodes codec assignments from extension decorations for WHERE parameters', () => {
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
          email: userColumns.email,
        })
        .where(userColumns.id.eq(param('userId')))
        .build({ params: { userId: 42 } });

      expect(plan.meta.annotations).toBeDefined();
      expect(plan.meta.annotations?.codecs).toEqual({
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
});
