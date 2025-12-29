import type { SqlContract, SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlColumnIR, SqlSchemaIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';

/**
 * Creates a minimal valid SqlContract for testing.
 */
function createTestContract(
  tables: Record<string, StorageTable>,
  extensions: Record<string, unknown> = {},
): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    storage: { tables },
    models: {},
    relations: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    },
    extensions,
  } as SqlContract<SqlStorage>;
}

/**
 * Creates a minimal valid SqlSchemaIR for testing.
 */
function createTestSchemaIR(
  tables: Record<string, SqlTableIR>,
  extensions: readonly string[] = [],
): SqlSchemaIR {
  return { tables, extensions };
}

/**
 * Creates a minimal contract table for testing.
 */
function createContractTable(
  columns: Record<string, { nativeType: string; codecId?: string; nullable: boolean }>,
  options?: {
    primaryKey?: { columns: readonly string[]; name?: string };
    foreignKeys?: ReadonlyArray<{
      columns: readonly string[];
      references: { table: string; columns: readonly string[] };
      name?: string;
    }>;
    uniques?: ReadonlyArray<{ columns: readonly string[]; name?: string }>;
    indexes?: ReadonlyArray<{ columns: readonly string[]; name?: string }>;
  },
): StorageTable {
  const result: StorageTable = {
    columns: Object.fromEntries(
      Object.entries(columns).map(([name, col]) => [
        name,
        {
          nativeType: col.nativeType,
          codecId: col.codecId ?? `pg/${col.nativeType}@1`,
          nullable: col.nullable,
        },
      ]),
    ),
    foreignKeys: options?.foreignKeys ?? [],
    uniques: options?.uniques ?? [],
    indexes: options?.indexes ?? [],
  };
  if (options?.primaryKey) {
    return { ...result, primaryKey: options.primaryKey };
  }
  return result;
}

/**
 * Creates a minimal schema table for testing.
 */
function createSchemaTable(
  name: string,
  columns: Record<string, { nativeType: string; nullable: boolean }>,
  options?: {
    primaryKey?: { columns: readonly string[]; name?: string };
    foreignKeys?: ReadonlyArray<{
      columns: readonly string[];
      referencedTable: string;
      referencedColumns: readonly string[];
      name?: string;
    }>;
    uniques?: ReadonlyArray<{ columns: readonly string[]; name?: string }>;
    indexes?: ReadonlyArray<{ columns: readonly string[]; unique: boolean; name?: string }>;
  },
): SqlTableIR {
  const result: SqlTableIR = {
    name,
    columns: Object.fromEntries(
      Object.entries(columns).map(([colName, col]) => [
        colName,
        { name: colName, nativeType: col.nativeType, nullable: col.nullable } as SqlColumnIR,
      ]),
    ),
    foreignKeys: options?.foreignKeys ?? [],
    uniques: options?.uniques ?? [],
    indexes: options?.indexes ?? [],
  };
  if (options?.primaryKey) {
    return { ...result, primaryKey: options.primaryKey };
  }
  return result;
}

describe('verifySqlSchema', () => {
  const emptyTypeMetadataRegistry = new Map<string, { nativeType?: string }>();

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
      });

      expect(result.ok).toBe(true);
      expect(result.schema.issues).toHaveLength(0);
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
      const contract = createTestContract(
        { user: createContractTable({ id: { nativeType: 'int4', nullable: false } }) },
        { pgvector: {} },
      );

      const schema = createTestSchemaIR(
        { user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }) },
        [], // No extensions
      );

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'extension_missing',
        }),
      );
    });
  });

  describe('strict mode', () => {
    it('detects extra tables in schema when strict is true', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
        extra_table: createSchemaTable('extra_table', {
          id: { nativeType: 'int4', nullable: false },
        }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: true,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'missing_table',
          table: 'extra_table',
        }),
      );
    });

    it('detects extra columns in schema when strict is true', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          extra_column: { nativeType: 'text', nullable: true },
        }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: true,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'missing_column',
          table: 'user',
          column: 'extra_column',
        }),
      );
    });
  });

  describe('result structure', () => {
    it('includes contract hashes and target info', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
      });

      expect(result.contract.coreHash).toBe('sha256:test');
      expect(result.target.expected).toBe('postgres');
    });

    it('includes counts in result', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
      });

      expect(result.schema.counts).toMatchObject({
        pass: expect.any(Number),
        warn: expect.any(Number),
        fail: expect.any(Number),
        totalNodes: expect.any(Number),
      });
    });
  });
});
