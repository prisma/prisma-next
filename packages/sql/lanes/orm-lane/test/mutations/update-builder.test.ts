import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract-types';
import { param } from '@prisma-next/sql-relational-core/param';
import type { AnyBinaryBuilder } from '@prisma-next/sql-relational-core/types';
import type { RuntimeContext } from '@prisma-next/sql-runtime';
import type { UpdateAst } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { buildUpdatePlan } from '../../src/mutations/update-builder';
import type { OrmContext } from '../../src/orm/context';
import type { ModelColumnAccessor } from '../../src/orm-types';

describe('update builder', () => {
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
          email: { column: 'email' },
        },
        relations: {},
      },
    },
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            email: { type: 'pg/text@1', nullable: true },
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
          sql: 'UPDATE user SET email = $1 WHERE id = $2',
          params: ctx.params ? [...ctx.params] : [],
        }),
      };
    },
  };

  const context: OrmContext<SqlContract<SqlStorage>> = {
    contract,
    adapter: adapter as unknown as OrmContext<SqlContract<SqlStorage>>['adapter'],
    context: {} as unknown as RuntimeContext<SqlContract<SqlStorage>>,
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

  it('builds update plan with data and where clause', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
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
      sql: plan.sql,
    }).toMatchObject({
      defined: true,
      lane: 'orm',
      tables: ['user'],
      astKind: 'update',
      sql: 'UPDATE user SET email = $1 WHERE id = $2',
    });
  });

  it('throws error when data is empty', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
    };

    expect(() => {
      buildUpdatePlan(context, 'User', where, getModelAccessor, {}, { params: { userId: 1 } });
    }).toThrow('update() requires at least one field');
  });

  it('throws error when data is null', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
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
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
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
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
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
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
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
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
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
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
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

  it('builds update plan without codecId when column type is missing', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
    };

    const contractWithoutType: SqlContract<SqlStorage> = {
      ...contract,
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: true },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };

    const contextWithoutType: OrmContext<SqlContract<SqlStorage>> = {
      ...context,
      contract: contractWithoutType,
    };

    const plan = buildUpdatePlan(
      contextWithoutType,
      'User',
      where,
      getModelAccessor,
      { email: 'updated@example.com' },
      { params: { userId: 1 } },
    );

    expect({
      emailCodec: plan.meta.annotations?.codecs?.['email'],
      userIdCodec: plan.meta.annotations?.codecs?.['userId'],
    }).toMatchObject({
      emailCodec: undefined,
      userIdCodec: 'pg/int4@1',
    });
  });

  it('builds update plan without codecs when no codecIds', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
    };

    const contractWithoutCodecs: SqlContract<SqlStorage> = {
      ...contract,
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: true },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };

    const contextWithoutCodecs: OrmContext<SqlContract<SqlStorage>> = {
      ...context,
      contract: contractWithoutCodecs,
    };

    const plan = buildUpdatePlan(
      contextWithoutCodecs,
      'User',
      where,
      getModelAccessor,
      { email: 'updated@example.com' },
      { params: { userId: 1 } },
    );

    expect({
      codecs: plan.meta.annotations?.codecs,
      intent: plan.meta.annotations?.['intent'],
      isMutation: plan.meta.annotations?.['isMutation'],
    }).toMatchObject({
      codecs: undefined,
      intent: 'write',
      isMutation: true,
    });
  });

  it('builds update plan with nullable column', () => {
    const where = (
      model: ModelColumnAccessor<SqlContract<SqlStorage>, Record<string, never>, 'User'>,
    ) => {
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
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
      return (model as Record<string, { eq: (p: unknown) => AnyBinaryBuilder }>)['id']!.eq(
        param('userId'),
      ) as AnyBinaryBuilder;
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
