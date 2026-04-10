import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { extractOperationStatements } from '../src/control-api/operations/extract-operation-statements';

describe('extractOperationStatements', () => {
  it('returns undefined for unknown family', () => {
    const ops: MigrationPlanOperation[] = [];
    const result = extractOperationStatements('unknown-family', ops);
    expect(result).toBeUndefined();
  });

  it('delegates to SQL extractor for sql family', () => {
    const ops: MigrationPlanOperation[] = [
      {
        id: 'op1',
        label: 'test',
        operationClass: 'additive',
        execute: [{ sql: 'CREATE TABLE t (id int)' }],
      } as unknown as MigrationPlanOperation,
    ];
    const result = extractOperationStatements('sql', ops);
    expect(result).toBeDefined();
    expect(result).toContain('CREATE TABLE t (id int)');
  });

  it('delegates to Mongo extractor for mongo family', () => {
    const ops: MigrationPlanOperation[] = [
      {
        id: 'op1',
        label: 'test',
        operationClass: 'additive',
        execute: [
          {
            description: 'create index',
            command: {
              kind: 'createIndex',
              collection: 'users',
              keys: [{ field: 'email', direction: 1 }],
            },
          },
        ],
      } as unknown as MigrationPlanOperation,
    ];
    const result = extractOperationStatements('mongo', ops);
    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result![0]).toContain('db.users.createIndex');
    expect(result![0]).toContain('"email"');
  });

  it('extracts mongo dropIndex statement', () => {
    const ops: MigrationPlanOperation[] = [
      {
        id: 'op1',
        label: 'test',
        operationClass: 'destructive',
        execute: [
          {
            description: 'drop index',
            command: {
              kind: 'dropIndex',
              collection: 'users',
              name: 'email_1',
            },
          },
        ],
      } as unknown as MigrationPlanOperation,
    ];
    const result = extractOperationStatements('mongo', ops);
    expect(result).toEqual(['db.users.dropIndex("email_1")']);
  });

  it('returns empty array for mongo family with no execute steps', () => {
    const ops: MigrationPlanOperation[] = [
      { id: 'op1', label: 'test', operationClass: 'additive' } as unknown as MigrationPlanOperation,
    ];
    const result = extractOperationStatements('mongo', ops);
    expect(result).toEqual([]);
  });
});
