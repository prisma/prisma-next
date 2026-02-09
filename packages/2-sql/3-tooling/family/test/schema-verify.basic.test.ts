import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createMockPostgresComponent,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

describe('verifySqlSchema - basic', () => {
  describe('matching schema', () => {
    it('returns ok: true when schema matches contract', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
          email: { nativeType: 'text', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          email: { nativeType: 'text', nullable: false },
        }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      expect(result.schema.issues).toHaveLength(0);
    });

    it('treats parameterized native types as matching when expanded', () => {
      const contract: SqlContract<SqlStorage> = {
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test' as never,
        storage: {
          tables: {
            user: {
              columns: {
                email: {
                  nativeType: 'character varying',
                  codecId: 'sql/varchar@1',
                  nullable: false,
                  typeParams: { length: 255 },
                },
              },
              primaryKey: { columns: ['email'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        models: {},
        relations: {},
        mappings: {
          codecTypes: {},
          operationTypes: {},
        },
        capabilities: {},
        extensionPacks: {},
        meta: {},
        sources: {},
      };

      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          {
            email: { nativeType: 'character varying(255)', nullable: false },
          },
          {
            primaryKey: { columns: ['email'] },
          },
        ),
      });

      // Use mock postgres component to provide the expandNativeType hook
      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [createMockPostgresComponent()],
      });

      expect(result.ok).toBe(true);
      expect(result.schema.issues).toHaveLength(0);
    });

    it('reports type mismatch when schema omits parameters', () => {
      const contract: SqlContract<SqlStorage> = {
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test' as never,
        storage: {
          tables: {
            user: {
              columns: {
                email: {
                  nativeType: 'character varying',
                  codecId: 'sql/varchar@1',
                  nullable: false,
                  typeParams: { length: 255 },
                },
              },
              primaryKey: { columns: ['email'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        models: {},
        relations: {},
        mappings: {
          codecTypes: {},
          operationTypes: {},
        },
        capabilities: {},
        extensionPacks: {},
        meta: {},
        sources: {},
      };

      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          {
            email: { nativeType: 'character varying', nullable: false },
          },
          {
            primaryKey: { columns: ['email'] },
          },
        ),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [createMockPostgresComponent()],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'type_mismatch',
          table: 'user',
          column: 'email',
          expected: 'character varying(255)',
          actual: 'character varying',
        }),
      );
    });
  });

  describe('missing table', () => {
    it('returns missing_table issue when contract table is not in schema', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({});

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'missing_table',
          table: 'user',
        }),
      );
    });
  });

  describe('missing column', () => {
    it('returns missing_column issue when contract column is not in schema table', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
          email: { nativeType: 'text', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          // email column missing
        }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'missing_column',
          table: 'user',
          column: 'email',
        }),
      );
    });
  });

  describe('type mismatch', () => {
    it('returns type_mismatch issue when column types differ', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int8', nullable: false }, // Different type
        }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'type_mismatch',
          table: 'user',
          column: 'id',
          expected: 'int4',
          actual: 'int8',
        }),
      );
    });
  });

  describe('nullability mismatch', () => {
    it('returns nullability_mismatch issue when nullability differs', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: true }, // Different nullability
        }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'id',
        }),
      );
    });
  });
});
