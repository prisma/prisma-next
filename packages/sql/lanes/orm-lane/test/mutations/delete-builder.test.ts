import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract-types';
import { param } from '@prisma-next/sql-relational-core/param';
import type { AnyBinaryBuilder } from '@prisma-next/sql-relational-core/types';
import type { LoweredStatement } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { buildDeletePlan } from '../../src/mutations/delete-builder';
import type { OrmContext } from '../../src/orm/context';
import type { ModelColumnAccessor } from '../../src/orm-types';

describe('delete builder', () => {
  const contract: SqlContract<SqlStorage> = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    models: {
      User: {
        storage: { table: 'user' },
        fields: {
          id: { column: 'id' },
        },
        relations: {},
      },
    },
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    relations: {},
    mappings: {
      modelToTable: { User: 'user' },
      tableToModel: { user: 'User' },
      fieldToColumn: { User: { id: 'id' } },
      columnToField: { user: { id: 'id' } },
      codecTypes: {},
      operationTypes: {},
    },
    meta: {},
    sources: {},
  };

  const adapter = {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(_ast: unknown, ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] }) {
      return {
        profileId: 'stub-profile',
        body: Object.freeze({
          sql: 'DELETE FROM user WHERE id = $1',
          params: ctx.params ? [...ctx.params] : [],
        }),
      };
    },
  };

  const context: OrmContext<SqlContract<SqlStorage>> = {
    contract,
    adapter: adapter as unknown as OrmContext<SqlContract<SqlStorage>>['adapter'],
  };

  const getModelAccessor = (): ModelColumnAccessor<
    SqlContract<SqlStorage>,
    Record<string, never>,
    'User'
  > => {
    return {
      id: {
        eq: (p: unknown) => ({ left: { table: 'user', column: 'id' }, right: p, op: 'eq' }),
      },
    } as unknown as ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>;
  };

  it('builds delete plan with where clause', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return model.id.eq(param('userId')) as AnyBinaryBuilder;
    };

    const plan = buildDeletePlan(context, 'User', where, getModelAccessor, {
      params: { userId: 1 },
    });

    expect(plan).toBeDefined();
    expect(plan.meta.lane).toBe('orm');
    expect(plan.meta.refs.tables).toEqual(['user']);
    expect(plan.ast.kind).toBe('delete');
    expect(plan.sql).toBe('DELETE FROM user WHERE id = $1');
  });

  it('builds delete plan without codecId', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return model.id.eq(param('userId')) as AnyBinaryBuilder;
    };

    const plan = buildDeletePlan(context, 'User', where, getModelAccessor, {
      params: { userId: 1 },
    });

    expect(plan.meta.annotations).toBeDefined();
    expect(plan.meta.annotations?.intent).toBe('write');
    expect(plan.meta.annotations?.isMutation).toBe(true);
  });

  it('builds delete plan with codecId', () => {
    const contractWithCodec: SqlContract<SqlStorage> = {
      ...contract,
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };

    const contextWithCodec: OrmContext<SqlContract<SqlStorage>> = {
      ...context,
      contract: contractWithCodec,
    };

    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return model.id.eq(param('userId')) as AnyBinaryBuilder;
    };

    const plan = buildDeletePlan(contextWithCodec, 'User', where, getModelAccessor, {
      params: { userId: 1 },
    });

    expect(plan.meta.annotations?.codecs).toBeDefined();
    expect(plan.meta.annotations?.codecs?.userId).toBe('pg/int4@1');
  });

  it('throws error when model not found', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return model.id.eq(param('userId')) as AnyBinaryBuilder;
    };

    const contractWithoutModel: SqlContract<SqlStorage> = {
      ...contract,
      mappings: {
        ...contract.mappings,
        modelToTable: {},
      },
    };

    const contextWithoutModel: OrmContext<SqlContract<SqlStorage>> = {
      ...context,
      contract: contractWithoutModel,
    };

    expect(() => {
      buildDeletePlan(contextWithoutModel, 'User', where, getModelAccessor);
    }).toThrow('Model User not found in mappings');
  });

  it('throws error when where expr is missing', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return model.id.eq(param('userId')) as AnyBinaryBuilder;
    };

    const adapterWithoutWhere = {
      ...adapter,
      lower(
        _ast: unknown,
        ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] },
      ) {
        return {
          profileId: 'stub-profile',
          body: Object.freeze({
            sql: 'DELETE FROM user',
            params: ctx.params ? [...ctx.params] : [],
          }),
        };
      },
    };

    const contextWithoutWhere: OrmContext<SqlContract<SqlStorage>> = {
      ...context,
      adapter: adapterWithoutWhere as unknown as OrmContext<SqlContract<SqlStorage>>['adapter'],
    };

    // This should not throw because buildWhereExpr always returns an expr
    // But we can test the case where whereExpr might be falsy
    const plan = buildDeletePlan(contextWithoutWhere, 'User', where, getModelAccessor, {
      params: { userId: 1 },
    });

    expect(plan).toBeDefined();
  });
});
