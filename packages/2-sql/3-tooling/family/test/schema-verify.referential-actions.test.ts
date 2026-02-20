import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

describe('verifySqlSchema - referential actions', () => {
  it('passes when contract and schema FK referential actions match', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      post: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
          userId: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              onDelete: 'cascade',
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
          userId: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              referencedTable: 'user',
              referencedColumns: ['id'],
              onDelete: 'cascade',
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

  it('fails when contract FK has onDelete but schema FK has different onDelete', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      post: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
          userId: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              onDelete: 'cascade',
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
          userId: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              referencedTable: 'user',
              referencedColumns: ['id'],
              onDelete: 'restrict',
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

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'foreign_key_mismatch',
        table: 'post',
      }),
    );
  });

  it('fails when contract FK has onUpdate but schema FK has different onUpdate', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      post: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
          userId: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              onUpdate: 'cascade',
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
          userId: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              referencedTable: 'user',
              referencedColumns: ['id'],
              onUpdate: 'restrict',
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

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'foreign_key_mismatch',
        table: 'post',
      }),
    );
  });

  it('passes when contract FK specifies noAction and schema has undefined (database default)', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      post: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
          userId: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              onDelete: 'noAction',
              onUpdate: 'noAction',
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
          userId: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              referencedTable: 'user',
              referencedColumns: ['id'],
              // onDelete and onUpdate are undefined (sparse IR for NO ACTION)
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

  it('passes when contract FK omits referential actions (does not compare)', () => {
    const contract = createTestContract({
      user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
      post: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
          userId: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
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
          userId: { nativeType: 'int4', nullable: false },
        },
        {
          foreignKeys: [
            {
              columns: ['userId'],
              referencedTable: 'user',
              referencedColumns: ['id'],
              onDelete: 'cascade',
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
