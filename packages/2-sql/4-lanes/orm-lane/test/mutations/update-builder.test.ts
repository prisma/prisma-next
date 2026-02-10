import { createOperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { UpdateAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { AnyBinaryBuilder } from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import { buildUpdatePlan } from '../../src/mutations/update-builder';
import type { OrmContext } from '../../src/orm/context';
import type { ModelColumnAccessor } from '../../src/orm-types';

describe('update builder', () => {
  const contract: SqlContract<SqlStorage> = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: 'sha256:test' as never,
    models: {
      User: {
        storage: { table: 'user' },
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
        relations: {},
      },
    },
    storage: {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
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
      fieldToColumn: { User: { id: 'id', email: 'email' } },
      columnToField: { user: { id: 'id', email: 'email' } },
      codecTypes: {},
      operationTypes: {},
    },
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };

  const context: OrmContext<SqlContract<SqlStorage>> = {
    contract,
    operations: createOperationRegistry(),
    codecs: createCodecRegistry(),
    types: {},
    applyMutationDefaults: () => [],
  };

  const getModelAccessor: () => ModelColumnAccessor<
    SqlContract<SqlStorage>,
    Record<string, never>,
    'User'
  > = () => {
    const tables = schema(context).tables;
    const userTable = tables['user']!;
    return {
      id: userTable.columns['id']!,
      email: userTable.columns['email']!,
    } as ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>;
  };

  it('builds update plan with data and where clause', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ): AnyBinaryBuilder => {
      return (model as { id: { eq: (p: unknown) => AnyBinaryBuilder } }).id.eq(param('userId'));
    };

    const plan = buildUpdatePlan(
      context,
      'User',
      where,
      getModelAccessor,
      { email: 'updated@example.com' },
      { params: { userId: 1 } },
    );

    expect({
      defined: plan !== undefined,
      lane: plan.meta.lane,
      tables: plan.meta.refs?.tables,
      astKind: (plan.ast as UpdateAst).kind,
      hasParams: plan.params.length > 0,
    }).toMatchObject({
      defined: true,
      lane: 'orm',
      tables: ['user'],
      astKind: 'update',
      hasParams: true,
    });
  });

  it('throws error when data is empty', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as { id: { eq: (p: unknown) => AnyBinaryBuilder } }).id.eq(param('userId'));
    };

    expect(() => {
      buildUpdatePlan(context, 'User', where, getModelAccessor, {}, { params: { userId: 1 } });
    }).toThrow('update() requires at least one field');
  });

  it('throws error when data is null', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as { id: { eq: (p: unknown) => AnyBinaryBuilder } }).id.eq(param('userId'));
    };

    expect(() => {
      buildUpdatePlan(
        context,
        'User',
        where,
        getModelAccessor,
        null as unknown as Record<string, unknown>,
        { params: { userId: 1 } },
      );
    }).toThrow('update() requires at least one field');
  });

  it('throws error when model not found', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as { id: { eq: (p: unknown) => AnyBinaryBuilder } }).id.eq(param('userId'));
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
      buildUpdatePlan(contextWithoutModel, 'User', where, getModelAccessor, {
        email: 'updated@example.com',
      });
    }).toThrow('Model User not found in mappings');
  });

  it('throws error when table not found', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as { id: { eq: (p: unknown) => AnyBinaryBuilder } }).id.eq(param('userId'));
    };

    const contractWithoutTable: SqlContract<SqlStorage> = {
      ...contract,
      storage: {
        tables: {},
      },
    };

    const contextWithoutTable: OrmContext<SqlContract<SqlStorage>> = {
      ...context,
      contract: contractWithoutTable,
    };

    expect(() => {
      buildUpdatePlan(contextWithoutTable, 'User', where, getModelAccessor, {
        email: 'updated@example.com',
      });
    }).toThrow('Unknown table user');
  });

  it('throws error when column not found', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as { id: { eq: (p: unknown) => AnyBinaryBuilder } }).id.eq(param('userId'));
    };

    const contractWithInvalidColumn: SqlContract<SqlStorage> = {
      ...contract,
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'invalid_column' },
          },
          relations: {},
        },
      },
      mappings: {
        ...contract.mappings,
        fieldToColumn: { User: { id: 'id', email: 'invalid_column' } },
      },
    };

    const contextWithInvalidColumn: OrmContext<SqlContract<SqlStorage>> = {
      ...context,
      contract: contractWithInvalidColumn,
    };

    expect(() => {
      buildUpdatePlan(contextWithInvalidColumn, 'User', where, getModelAccessor, {
        email: 'updated@example.com',
      });
    }).toThrow('Unknown column invalid_column in table user');
  });

  it('throws error when parameter is missing', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as { id: { eq: (p: unknown) => AnyBinaryBuilder } }).id.eq(param('userId'));
    };

    expect(() => {
      buildUpdatePlan(
        context,
        'User',
        where,
        getModelAccessor,
        { email: 'updated@example.com' },
        {
          params: {},
        },
      );
    }).toThrow('Missing value for parameter');
  });

  it('builds update plan with codecId', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as { id: { eq: (p: unknown) => AnyBinaryBuilder } }).id.eq(param('userId'));
    };

    const plan = buildUpdatePlan(
      context,
      'User',
      where,
      getModelAccessor,
      { email: 'updated@example.com' },
      { params: { userId: 1 } },
    );

    expect({
      codecsDefined: plan.meta.annotations?.codecs !== undefined,
      emailCodec: plan.meta.annotations?.codecs?.['email'],
      userIdCodec: plan.meta.annotations?.codecs?.['userId'],
    }).toMatchObject({
      codecsDefined: true,
      emailCodec: 'pg/text@1',
      userIdCodec: 'pg/int4@1',
    });
  });

  it('builds update plan with nullable column', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as { id: { eq: (p: unknown) => AnyBinaryBuilder } }).id.eq(param('userId'));
    };

    const plan = buildUpdatePlan(
      context,
      'User',
      where,
      getModelAccessor,
      { email: 'updated@example.com' },
      { params: { userId: 1 } },
    );

    const paramDescriptors = plan.meta.paramDescriptors;
    const emailDescriptor = paramDescriptors.find((d) => d.name === 'email');
    expect(emailDescriptor?.nullable).toBe(true);
  });

  it('builds update plan with options params merged with data', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as { id: { eq: (p: unknown) => AnyBinaryBuilder } }).id.eq(param('userId'));
    };

    const plan = buildUpdatePlan(
      context,
      'User',
      where,
      getModelAccessor,
      { email: 'updated@example.com' },
      { params: { userId: 1, extraParam: 'value' } },
    );

    expect(plan.params).toContain('updated@example.com');
    expect(plan.params).toContain(1);
  });
});
