import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { param } from '../src/param';
import { schema } from '../src/schema';
import { sql } from '../src/sql';
import type { DataContract } from '@prisma-next/contract/types';
import type {
  ParamDescriptor,
  Adapter,
  LoweredStatement,
  SelectAst,
} from '../src/types';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): DataContract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  return JSON.parse(contents);
}

function createStubAdapter(): Adapter<SelectAst, DataContract, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
    },
    lower(ast: SelectAst, ctx: { contract: DataContract; params?: readonly unknown[] }) {
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
      .select('id', 'email')
      .where(userColumns.id.eq(param('userId')))
      .orderBy(userColumns.createdAt.desc())
      .limit(5)
      .build({ params: { userId: 42 } });

    expect(plan.ast).toMatchObject({
      kind: 'select',
      from: { name: 'user' },
      project: [
        { alias: 'id', expr: { table: 'user', column: 'id' } },
        { alias: 'email', expr: { table: 'user', column: 'email' } },
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

  it('throws PLAN.INVALID when selecting an unknown column', () => {
    const builder = sql({ contract, adapter }).from(tables.user);

    expect(() => builder.select('unknown')).toThrowError(/Unknown column unknown/);
  });

  it('throws PLAN.INVALID when parameter value is missing', () => {
    const userColumns = tables.user.columns;

    const builder = sql({ contract, adapter })
      .from(tables.user)
      .select('id')
      .where(userColumns.id.eq(param('userId')));

    expect(() => builder.build()).toThrowError(/Missing value for parameter userId/);
  });
});
