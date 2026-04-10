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

  it('returns undefined for mongo family', () => {
    const ops: MigrationPlanOperation[] = [];
    const result = extractOperationStatements('mongo', ops);
    expect(result).toBeUndefined();
  });
});
