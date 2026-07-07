import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { collectSqlSchemaIssues } from '../src/core/diff/sql-schema-diff';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
} from './schema-verify.helpers';

describe('collectSqlSchemaIssues - referential actions', () => {
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
              source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
              target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
              onDelete: 'cascade',
              index: false,
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

    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents: [],
    });

    expect(issues).toEqual([]);
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
              source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
              target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
              onDelete: 'cascade',
              index: false,
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

    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents: [],
    });

    expect(issues).toContainEqual(
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
              source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
              target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
              onUpdate: 'cascade',
              index: false,
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

    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents: [],
    });

    expect(issues).toContainEqual(
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
              source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
              target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
              onDelete: 'noAction',
              onUpdate: 'noAction',
              index: false,
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

    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents: [],
    });

    expect(issues).toEqual([]);
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
              source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
              target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
              index: false,
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

    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents: [],
    });

    expect(issues).toEqual([]);
  });
});
