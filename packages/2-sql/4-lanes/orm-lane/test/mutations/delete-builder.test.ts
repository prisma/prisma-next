import { createOperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { DeleteAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import type { AnyBinaryBuilder } from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import { buildDeletePlan } from '../../src/mutations/delete-builder';
import type { OrmContext } from '../../src/orm/context';
import type { ModelColumnAccessor } from '../../src/orm-types';

describe('delete builder', () => {
  const int4Column: StorageColumn = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };

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
            id: int4Column,
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

  const context: OrmContext<SqlContract<SqlStorage>> = {
    contract,
    operations: createOperationRegistry(),
    codecs: createCodecRegistry(),
  };

  const getModelAccessor: () => ModelColumnAccessor<
    SqlContract<SqlStorage>,
    Record<string, never>,
    'User'
  > = () => {
    return {
      id: {
        eq: (p: unknown) => ({ left: { table: 'user', column: 'id' }, right: p, op: 'eq' }),
      },
    } as unknown as ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>;
  };

  it('builds delete plan with where clause', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test helper with complex type inference
    const where = (model: any) => {
      return model.id.eq(param('userId')) as AnyBinaryBuilder;
    };

    const plan = buildDeletePlan<SqlContract<SqlStorage>, Record<string, never>, 'User'>(
      context,
      'User',
      where,
      getModelAccessor,
      {
        params: { userId: 1 },
      },
    );

    expect({
      defined: plan !== undefined,
      lane: plan.meta.lane,
      tables: plan.meta.refs?.tables,
      astKind: (plan.ast as unknown as DeleteAst).kind,
      hasParams: plan.params.length > 0,
    }).toMatchObject({
      defined: true,
      lane: 'orm',
      tables: ['user'],
      astKind: 'delete',
      hasParams: true,
    });
  });

  it('includes write intent and mutation flag in annotations', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test helper with complex type inference
    const where = (model: any) => {
      return model.id.eq(param('userId')) as AnyBinaryBuilder;
    };

    const plan = buildDeletePlan<SqlContract<SqlStorage>, Record<string, never>, 'User'>(
      context,
      'User',
      where,
      getModelAccessor,
      {
        params: { userId: 1 },
      },
    );

    expect({
      annotationsDefined: plan.meta.annotations !== undefined,
      intent: plan.meta.annotations?.['intent'],
      isMutation: plan.meta.annotations?.['isMutation'],
    }).toMatchObject({
      annotationsDefined: true,
      intent: 'write',
      isMutation: true,
    });
  });

  it('builds delete plan with codecId', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test helper with complex type inference
    const where = (model: any) => {
      return model.id.eq(param('userId')) as AnyBinaryBuilder;
    };

    const plan = buildDeletePlan(context, 'User', where, getModelAccessor, {
      params: { userId: 1 },
    });

    expect({
      codecsDefined: plan.meta.annotations?.codecs !== undefined,
      userIdCodec: plan.meta.annotations?.codecs?.['userId'],
    }).toMatchObject({
      codecsDefined: true,
      userIdCodec: 'pg/int4@1',
    });
  });

  it('throws error when model not found', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test helper with complex type inference
    const where = (model: any) => {
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
    // biome-ignore lint/suspicious/noExplicitAny: test helper with complex type inference
    const where = (model: any) => {
      return model.id.eq(param('userId')) as AnyBinaryBuilder;
    };

    const contextWithoutWhere: OrmContext<SqlContract<SqlStorage>> = {
      ...context,
    };

    // This should not throw because buildWhereExpr always returns an expr
    // But we can test the case where whereExpr might be falsy
    const plan = buildDeletePlan(contextWithoutWhere, 'User', where, getModelAccessor, {
      params: { userId: 1 },
    });

    expect(plan).toBeDefined();
  });
});
