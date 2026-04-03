import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

describe('verifySqlSchema - strict mode', () => {
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
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'extra_table',
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
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'extra_column',
        table: 'user',
        column: 'extra_column',
      }),
    );
  });
});

describe('verifySqlSchema - result structure', () => {
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
      frameworkComponents: [],
    });

    expect(result.contract.storageHash).toBe('sha256:test');
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
      frameworkComponents: [],
    });

    expect(result.schema.counts).toMatchObject({
      pass: expect.any(Number),
      warn: expect.any(Number),
      fail: expect.any(Number),
      totalNodes: expect.any(Number),
    });
  });

  it('detects extra foreign keys when contract has no FKs for the table', () => {
    const contract = createTestContract({
      parent: createContractTable({
        id: { nativeType: 'int4', nullable: false },
      }),
      child: createContractTable({
        id: { nativeType: 'int4', nullable: false },
        parent_id: { nativeType: 'int4', nullable: false },
      }),
    });

    const schema = createTestSchemaIR({
      parent: createSchemaTable('parent', {
        id: { nativeType: 'int4', nullable: false },
      }),
      child: createSchemaTable(
        'child',
        {
          id: { nativeType: 'int4', nullable: false },
          parent_id: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['parent_id'],
              referencedTable: 'parent',
              referencedColumns: ['id'],
              name: 'child_parent_id_fkey',
            },
          ],
        },
      ),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: true,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'extra_foreign_key',
        table: 'child',
        indexOrConstraint: 'child_parent_id_fkey',
      }),
    );
  });
});
