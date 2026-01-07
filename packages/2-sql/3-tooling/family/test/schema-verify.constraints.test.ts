import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema.ts';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers.ts';

describe('verifySqlSchema - constraints', () => {
  describe('primary key mismatch', () => {
    it('returns primary_key_mismatch issue when PK is missing in schema', () => {
      const contract = createTestContract({
        user: createContractTable(
          { id: { nativeType: 'int4', nullable: false } },
          { primaryKey: { columns: ['id'] } },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
        }),
        // No primaryKey in schema
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
          kind: 'primary_key_mismatch',
          table: 'user',
        }),
      );
    });
  });

  describe('foreign key mismatch', () => {
    it('returns foreign_key_mismatch issue when FK is missing in schema', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
        post: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            author_id: { nativeType: 'int4', nullable: false },
          },
          {
            foreignKeys: [
              { columns: ['author_id'], references: { table: 'user', columns: ['id'] } },
            ],
          },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
        post: createSchemaTable('post', {
          id: { nativeType: 'int4', nullable: false },
          author_id: { nativeType: 'int4', nullable: false },
        }),
        // No foreignKey in schema
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
          kind: 'foreign_key_mismatch',
          table: 'post',
        }),
      );
    });
  });

  describe('unique constraint mismatch', () => {
    it('returns unique_constraint_mismatch issue when unique constraint is missing', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          { uniques: [{ columns: ['email'] }] },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          email: { nativeType: 'text', nullable: false },
        }),
        // No unique constraint in schema
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
          kind: 'unique_constraint_mismatch',
          table: 'user',
        }),
      );
    });
  });

  describe('index mismatch', () => {
    it('returns index_mismatch issue when index is missing in schema', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            created_at: { nativeType: 'timestamptz', nullable: false },
          },
          { indexes: [{ columns: ['created_at'] }] },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          created_at: { nativeType: 'timestamptz', nullable: false },
        }),
        // No index in schema
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
          kind: 'index_mismatch',
          table: 'user',
        }),
      );
    });
  });

  describe('extension missing', () => {
    it('returns extension_missing issue when required extension is not in schema', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      });

      const schema = createTestSchemaIR(
        { user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }) },
        [], // No extensions
      );

      const frameworkComponents = [
        {
          kind: 'extension',
          id: 'pgvector',
          familyId: 'sql',
          targetId: 'postgres',
          version: '0.0.0',
          databaseDependencies: {
            init: [
              {
                id: 'postgres.extension.vector',
                label: 'Enable vector extension',
                install: [],
                verifyDatabaseDependencyInstalled: (s: SqlSchemaIR) => {
                  if (!s.extensions.includes('vector')) {
                    return [
                      {
                        kind: 'extension_missing',
                        table: '',
                        message: 'Extension "vector" is missing from database',
                      },
                    ];
                  }
                  return [];
                },
              },
            ],
          },
        } as const,
      ];

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents,
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'extension_missing',
        }),
      );
    });
  });
});
