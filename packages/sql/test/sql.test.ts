import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { expectTypeOf } from 'vitest';

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
  ResultType,
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
  const tables = schema(contract).tables;
  const adapter = createStubAdapter();

  it('builds a select plan with projection, where, order, and limit', () => {
    const userColumns = tables.user.columns;

    const plan = sql({ contract, adapter })
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
    const builder = sql({ contract, adapter }).from(tables.user);

    // Invalid: passing something that's not a ColumnBuilder
    expect(() => builder.select({ invalid: {} as unknown as ColumnBuilder })).toThrowError(
      /Invalid column projection/,
    );
  });

  it('throws PLAN.INVALID when parameter value is missing', () => {
    const userColumns = tables.user.columns;

    const builder = sql({ contract, adapter })
      .from(tables.user)
      .select({
        id: userColumns.id,
      })
      .where(userColumns.id.eq(param('userId')));

    expect(() => builder.build()).toThrowError(/Missing value for parameter userId/);
  });

  describe('codec assignments', () => {
    it('encodes codec assignments from contract mappings for projections', () => {
      const contractWithCodecs = {
        ...contract,
        mappings: {
          ...contract.mappings,
          columnToCodec: {
            user: {
              id: 'core/int@1',
              email: 'core/string@1',
            },
          },
        },
      } as Contract;

      const userColumns = tables.user.columns;
      const plan = sql({ contract: contractWithCodecs, adapter })
        .from(tables.user)
        .select({
          id: userColumns.id,
          email: userColumns.email,
        })
        .build();

      expect(plan.meta.annotations).toBeDefined();
      expect(plan.meta.annotations?.codecs).toEqual({
        id: 'core/int@1',
        email: 'core/string@1',
      });
    });

    it('encodes codec assignments from contract mappings for WHERE parameters', () => {
      const contractWithCodecs = {
        ...contract,
        mappings: {
          ...contract.mappings,
          columnToCodec: {
            user: {
              id: 'core/int@1',
            },
          },
        },
      } as Contract;

      const userColumns = tables.user.columns;
      const plan = sql({ contract: contractWithCodecs, adapter })
        .from(tables.user)
        .select({
          email: userColumns.email,
        })
        .where(userColumns.id.eq(param('userId')))
        .build({ params: { userId: 42 } });

      expect(plan.meta.annotations).toBeDefined();
      expect(plan.meta.annotations?.codecs).toEqual({
        userId: 'core/int@1',
      });
    });

    it('merges projection and parameter codec assignments', () => {
      const contractWithCodecs = {
        ...contract,
        mappings: {
          ...contract.mappings,
          columnToCodec: {
            user: {
              id: 'core/int@1',
              email: 'core/string@1',
            },
          },
        },
      } as Contract;

      const userColumns = tables.user.columns;
      const plan = sql({ contract: contractWithCodecs, adapter })
        .from(tables.user)
        .select({
          id: userColumns.id,
          email: userColumns.email,
        })
        .where(userColumns.id.eq(param('userId')))
        .build({ params: { userId: 42 } });

      expect(plan.meta.annotations).toBeDefined();
      expect(plan.meta.annotations?.codecs).toEqual({
        id: 'core/int@1',
        email: 'core/string@1',
        userId: 'core/int@1',
      });
    });

    it('includes codec annotations when codec mappings exist', () => {
      const userColumns = tables.user.columns;
      const plan = sql({ contract, adapter })
        .from(tables.user)
        .select({
          id: userColumns.id,
          email: userColumns.email,
        })
        .build();

      expect(plan.meta.annotations).toBeDefined();
      expect(plan.meta.annotations?.codecs).toEqual({
        id: 'core/int@1',
        email: 'core/string@1',
      });
    });

    it('only includes codecs for columns with mappings', () => {
      const contractWithPartialCodecs = {
        ...contract,
        mappings: {
          ...contract.mappings,
          columnToCodec: {
            user: {
              id: 'core/int@1',
            },
          },
        },
      } as Contract;

      const userColumns = tables.user.columns;
      const plan = sql({ contract: contractWithPartialCodecs, adapter })
        .from(tables.user)
        .select({
          id: userColumns.id,
          email: userColumns.email,
        })
        .build();

      expect(plan.meta.annotations?.codecs).toEqual({
        id: 'core/int@1',
      });
    });

    it('infers ResultType correctly when extension decorations with typeId are present', () => {
      // Create a contract with extension decorations
      const contractWithExtensions = {
        ...contract,
        extensions: {
          postgres: {
            decorations: {
              columns: [
                {
                  ref: { kind: 'column', table: 'user', column: 'id' },
                  payload: { typeId: 'core/string@1' },
                },
                {
                  ref: { kind: 'column', table: 'user', column: 'email' },
                  payload: { typeId: 'core/string@1' },
                },
              ],
            },
          },
        },
      };

      const contractValidated = validateContract<Contract>(contractWithExtensions);

      const testTables = schema(contractValidated).tables;
      const userColumns = testTables.user.columns;
      const plan = sql({ contract: contractValidated, adapter })
        .from(testTables.user)
        .select({
          id: userColumns.id,
          email: userColumns.email,
        })
        .build();

      expect(plan.meta.annotations?.codecs).toEqual({
        id: 'core/string@1',
        email: 'core/string@1',
      });

      type Row = ResultType<typeof plan>;

      expectTypeOf<Row>().toExtend<{
        id: string;
        email: string;
      }>();

      const _row: Row = { id: '1', email: 'test@example.com' } as unknown as Row;
      expect(_row).toBeDefined();
    });
  });
});
