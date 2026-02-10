import { createOperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { InsertAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { buildInsertPlan, convertModelFieldsToColumns } from '../../src/mutations/insert-builder';
import type { OrmContext } from '../../src/orm/context';

describe('insert builder', () => {
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

  describe('convertModelFieldsToColumns', () => {
    it('converts model fields to columns', () => {
      const fields = { id: 1, email: 'test@example.com' };
      const result = convertModelFieldsToColumns(contract, 'User', fields);

      expect({
        hasId: Object.hasOwn(result, 'id'),
        hasEmail: Object.hasOwn(result, 'email'),
        idName: result['id']?.name,
        emailName: result['email']?.name,
      }).toMatchObject({
        hasId: true,
        hasEmail: true,
        idName: 'id',
        emailName: 'email',
      });
    });

    it('uses fieldToColumn mapping when available', () => {
      const contractWithMapping: SqlContract<SqlStorage> = {
        ...contract,
        mappings: {
          ...contract.mappings,
          fieldToColumn: { User: { id: 'user_id', email: 'user_email' } },
        },
      };

      const fields = { id: 1, email: 'test@example.com' };
      const result = convertModelFieldsToColumns(contractWithMapping, 'User', fields);

      expect(result).toHaveProperty('user_id');
      expect(result).toHaveProperty('user_email');
    });

    it('uses field.column when fieldToColumn mapping is not available', () => {
      const contractWithoutMapping: SqlContract<SqlStorage> = {
        ...contract,
        mappings: {
          ...contract.mappings,
          fieldToColumn: {},
        },
      };

      const fields = { id: 1, email: 'test@example.com' };
      const result = convertModelFieldsToColumns(contractWithoutMapping, 'User', fields);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('email');
    });

    it('uses fieldName as fallback when column is not available', () => {
      const contractWithoutColumn: SqlContract<SqlStorage> = {
        ...contract,
        models: {
          User: {
            storage: { table: 'user' },
            fields: {
              id: {},
              email: {},
            },
            relations: {},
          },
        },
        mappings: {
          ...contract.mappings,
          fieldToColumn: {},
        },
      };

      const fields = { id: 1, email: 'test@example.com' };
      const result = convertModelFieldsToColumns(contractWithoutColumn, 'User', fields);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('email');
    });

    it('skips fields not in model', () => {
      const fields = { id: 1, email: 'test@example.com', invalidField: 'value' };
      expect(() => convertModelFieldsToColumns(contract, 'User', fields)).toThrow(
        'Field invalidField does not exist on model User',
      );
    });

    it('skips null fields', () => {
      const contractWithNullField: SqlContract<SqlStorage> = {
        ...contract,
        models: {
          User: {
            storage: { table: 'user' },
            fields: {
              id: { column: 'id' },
              email: { column: 'email' },
              nullField: null as unknown as { column?: string },
            },
            relations: {},
          },
        },
      };

      const fields = { id: 1, email: 'test@example.com', nullField: 'value' };
      const result = convertModelFieldsToColumns(contractWithNullField, 'User', fields);

      expect(result).not.toHaveProperty('nullField');
    });

    it('throws error when model does not have fields', () => {
      const contractWithoutFields: SqlContract<SqlStorage> = {
        ...contract,
        models: {
          User: {
            storage: { table: 'user' },
            fields: {},
            relations: {},
          },
        },
      };

      const fields = { id: 1 };
      expect(() => convertModelFieldsToColumns(contractWithoutFields, 'User', fields)).toThrow(
        'Field id does not exist on model User',
      );
    });
  });

  describe('buildInsertPlan', () => {
    it('builds insert plan with data', () => {
      const plan = buildInsertPlan(context, 'User', { id: 1, email: 'test@example.com' });

      expect({
        defined: plan !== undefined,
        lane: plan.meta.lane,
        tables: plan.meta.refs?.tables,
        astKind: (plan.ast as InsertAst).kind,
        hasParams: plan.params.length > 0,
      }).toMatchObject({
        defined: true,
        lane: 'orm',
        tables: ['user'],
        astKind: 'insert',
        hasParams: true,
      });
    });

    it('throws error when data is empty', () => {
      expect(() => buildInsertPlan(context, 'User', {})).toThrow(
        'create() requires at least one field',
      );
    });

    it('throws error when data is null', () => {
      expect(() =>
        buildInsertPlan(context, 'User', null as unknown as Record<string, unknown>),
      ).toThrow('create() requires at least one field');
    });

    it('throws error when model not found', () => {
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
        buildInsertPlan(contextWithoutModel, 'User', { id: 1 });
      }).toThrow('Model User not found in mappings');
    });

    it('throws error when table not found', () => {
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
        buildInsertPlan(contextWithoutTable, 'User', { id: 1 });
      }).toThrow('Unknown table user');
    });

    it('throws error when column not found', () => {
      const contractWithInvalidColumn: SqlContract<SqlStorage> = {
        ...contract,
        models: {
          User: {
            storage: { table: 'user' },
            fields: {
              id: { column: 'invalid_column' },
            },
            relations: {},
          },
        },
        mappings: {
          ...contract.mappings,
          fieldToColumn: { User: { id: 'invalid_column' } },
        },
      };

      const contextWithInvalidColumn: OrmContext<SqlContract<SqlStorage>> = {
        ...context,
        contract: contractWithInvalidColumn,
      };

      expect(() => {
        buildInsertPlan(contextWithInvalidColumn, 'User', { id: 1 });
      }).toThrow('Unknown column invalid_column in table user');
    });

    it('uses data values when params are not provided', () => {
      const plan = buildInsertPlan(
        context,
        'User',
        { id: 1, email: 'test@example.com' },
        {
          params: {},
        },
      );

      expect({
        hasId: plan.params.includes(1),
        hasEmail: plan.params.includes('test@example.com'),
      }).toMatchObject({
        hasId: true,
        hasEmail: true,
      });
    });

    it('builds insert plan with codecId', () => {
      const plan = buildInsertPlan(context, 'User', { id: 1, email: 'test@example.com' });

      expect({
        codecsDefined: plan.meta.annotations?.codecs !== undefined,
        idCodec: plan.meta.annotations?.codecs?.['id'],
        emailCodec: plan.meta.annotations?.codecs?.['email'],
      }).toMatchObject({
        codecsDefined: true,
        idCodec: 'pg/int4@1',
        emailCodec: 'pg/text@1',
      });
    });

    it('builds insert plan with nullable column', () => {
      const plan = buildInsertPlan(context, 'User', { id: 1, email: 'test@example.com' });

      const paramDescriptors = plan.meta.paramDescriptors;
      const emailDescriptor = paramDescriptors.find((d) => d.name === 'email');
      expect(emailDescriptor?.nullable).toBe(true);
    });

    it('builds insert plan with options params merged with data', () => {
      const plan = buildInsertPlan(
        context,
        'User',
        { id: 1, email: 'test@example.com' },
        { params: { extraParam: 'value' } },
      );

      expect({
        hasId: plan.params.includes(1),
        hasEmail: plan.params.includes('test@example.com'),
      }).toMatchObject({
        hasId: true,
        hasEmail: true,
      });
      // extraParam is in paramsMap but not used in the insert, so it won't be in plan.params
      // unless it's referenced by a placeholder
    });
  });
});
