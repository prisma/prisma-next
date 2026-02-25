import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

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

    it('returns unique_constraint_mismatch for missing composite unique constraint', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            first_name: { nativeType: 'text', nullable: false },
            last_name: { nativeType: 'text', nullable: false },
          },
          { uniques: [{ columns: ['first_name', 'last_name'] }] },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          first_name: { nativeType: 'text', nullable: false },
          last_name: { nativeType: 'text', nullable: false },
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
          kind: 'unique_constraint_mismatch',
          table: 'user',
        }),
      );
    });

    it('passes when composite unique constraint matches', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            first_name: { nativeType: 'text', nullable: false },
            last_name: { nativeType: 'text', nullable: false },
          },
          { uniques: [{ columns: ['first_name', 'last_name'] }] },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          {
            id: { nativeType: 'int4', nullable: false },
            first_name: { nativeType: 'text', nullable: false },
            last_name: { nativeType: 'text', nullable: false },
          },
          { uniques: [{ columns: ['first_name', 'last_name'], name: 'user_name_key' }] },
        ),
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
  });

  describe('FK with constraint: false', () => {
    it('skips FK constraint verification when constraint=false', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
        post: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            author_id: { nativeType: 'int4', nullable: false },
          },
          {
            foreignKeys: [
              {
                columns: ['author_id'],
                references: { table: 'user', columns: ['id'] },
                constraint: false,
                index: false,
              },
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
        // No FK in schema — should pass because constraint=false
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      expect(result.schema.issues.filter((i) => i.kind === 'foreign_key_mismatch')).toHaveLength(0);
    });

    it('still reports FK constraint mismatch when constraint=true', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
        post: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            author_id: { nativeType: 'int4', nullable: false },
          },
          {
            foreignKeys: [
              {
                columns: ['author_id'],
                references: { table: 'user', columns: ['id'] },
                constraint: true,
                index: false,
              },
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

    it('verifies user-declared indexes regardless of FK index flag', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
        post: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            author_id: { nativeType: 'int4', nullable: false },
          },
          {
            foreignKeys: [
              {
                columns: ['author_id'],
                references: { table: 'user', columns: ['id'] },
                constraint: false,
                index: false,
              },
            ],
            indexes: [{ columns: ['author_id'] }],
          },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
        post: createSchemaTable('post', {
          id: { nativeType: 'int4', nullable: false },
          author_id: { nativeType: 'int4', nullable: false },
        }),
        // No index in schema — should fail because user declared the index
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
          table: 'post',
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
