/**
 * Tests for semantic satisfaction verification behavior.
 *
 * These tests verify that schema verification uses semantic satisfaction:
 * - Identity is based on (table + kind + columns), not names
 * - Name differences are ignored (names are for DDL/diagnostics, not identity)
 * - Stronger objects can satisfy weaker requirements (e.g., unique index satisfies non-unique index)
 */
import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

describe('verifySqlSchema - semantic satisfaction', () => {
  describe('primary key', () => {
    it('passes when columns match but names differ', () => {
      const contract = createTestContract({
        user: createContractTable(
          { id: { nativeType: 'int4', nullable: false } },
          { primaryKey: { columns: ['id'], name: 'user_pk' } },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          { id: { nativeType: 'int4', nullable: false } },
          { primaryKey: { columns: ['id'], name: 'user_pkey' } },
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

    it('passes when schema has name but contract does not', () => {
      const contract = createTestContract({
        user: createContractTable(
          { id: { nativeType: 'int4', nullable: false } },
          { primaryKey: { columns: ['id'] } },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          { id: { nativeType: 'int4', nullable: false } },
          { primaryKey: { columns: ['id'], name: 'user_pkey' } },
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

  describe('unique constraint', () => {
    it('passes when columns match but names differ', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          { uniques: [{ columns: ['email'], name: 'user_email_unique' }] },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          {
            id: { nativeType: 'int4', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          { uniques: [{ columns: ['email'], name: 'user_email_key' }] },
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

    it('passes when satisfied by unique index with same columns', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          { uniques: [{ columns: ['email'] }] },
        ),
      });

      // Schema has a unique INDEX instead of a unique CONSTRAINT
      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          {
            id: { nativeType: 'int4', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          {
            uniques: [], // No unique constraint
            indexes: [{ columns: ['email'], unique: true, name: 'user_email_idx' }],
          },
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

    it('fails when no matching unique constraint or unique index', () => {
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
        user: createSchemaTable(
          'user',
          {
            id: { nativeType: 'int4', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          {
            // Only a non-unique index exists
            indexes: [{ columns: ['email'], unique: false, name: 'user_email_idx' }],
          },
        ),
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

  describe('index', () => {
    it('passes when columns match but names differ', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            created_at: { nativeType: 'timestamptz', nullable: false },
          },
          { indexes: [{ columns: ['created_at'], name: 'user_created_at_index' }] },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          {
            id: { nativeType: 'int4', nullable: false },
            created_at: { nativeType: 'timestamptz', nullable: false },
          },
          { indexes: [{ columns: ['created_at'], unique: false, name: 'user_created_at_idx' }] },
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

    it('passes when satisfied by unique index (stronger satisfies weaker)', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          { indexes: [{ columns: ['email'] }] }, // Non-unique index requirement
        ),
      });

      // Schema has a unique index on the same columns
      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          {
            id: { nativeType: 'int4', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          { indexes: [{ columns: ['email'], unique: true, name: 'user_email_idx' }] },
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

    it('passes when satisfied by unique constraint (stronger satisfies weaker)', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          { indexes: [{ columns: ['email'] }] }, // Non-unique index requirement
        ),
      });

      // Schema has a unique constraint on the same columns
      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          {
            id: { nativeType: 'int4', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          {
            uniques: [{ columns: ['email'], name: 'user_email_key' }],
            indexes: [],
          },
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

    it('fails when no matching index, unique index, or unique constraint', () => {
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
        // No indexes at all
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

  describe('foreign key', () => {
    it('passes when columns match but names differ', () => {
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
                name: 'post_author_fk',
              },
            ],
          },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
        post: createSchemaTable(
          'post',
          {
            id: { nativeType: 'int4', nullable: false },
            author_id: { nativeType: 'int4', nullable: false },
          },
          {
            foreignKeys: [
              {
                columns: ['author_id'],
                referencedTable: 'user',
                referencedColumns: ['id'],
                name: 'post_author_id_fkey',
              },
            ],
          },
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

    it('fails when foreign key is missing from schema', () => {
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
                name: 'post_author_fk',
              },
            ],
          },
        ),
      });

      // Schema has no foreign key
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

    it('passes with multi-column FK when columns and references match but names differ', () => {
      const contract = createTestContract({
        tenant: createContractTable({
          id: { nativeType: 'int4', nullable: false },
          org_id: { nativeType: 'int4', nullable: false },
        }),
        document: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            tenant_id: { nativeType: 'int4', nullable: false },
            tenant_org_id: { nativeType: 'int4', nullable: false },
          },
          {
            foreignKeys: [
              {
                columns: ['tenant_id', 'tenant_org_id'],
                references: { table: 'tenant', columns: ['id', 'org_id'] },
                name: 'document_tenant_fk',
              },
            ],
          },
        ),
      });

      const schema = createTestSchemaIR({
        tenant: createSchemaTable('tenant', {
          id: { nativeType: 'int4', nullable: false },
          org_id: { nativeType: 'int4', nullable: false },
        }),
        document: createSchemaTable(
          'document',
          {
            id: { nativeType: 'int4', nullable: false },
            tenant_id: { nativeType: 'int4', nullable: false },
            tenant_org_id: { nativeType: 'int4', nullable: false },
          },
          {
            foreignKeys: [
              {
                columns: ['tenant_id', 'tenant_org_id'],
                referencedTable: 'tenant',
                referencedColumns: ['id', 'org_id'],
                name: 'document_tenant_id_tenant_org_id_fkey', // Different name
              },
            ],
          },
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
});
