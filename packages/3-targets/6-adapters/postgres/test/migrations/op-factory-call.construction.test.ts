/**
 * Construction-side coverage for the Postgres migration IR call classes:
 * each `*Call` constructs with literal args, freezes itself, computes its
 * label, and lowers to the matching runtime op via `toOp()`. Renders are
 * exercised separately in op-factory-call.rendering.test.ts; multi-call
 * lowering is covered in op-factory-call.lowering.test.ts.
 */

import { CreateTableCall, DataTransformCall } from '@prisma-next/target-postgres/op-factory-call';
import { describe, expect, it } from 'vitest';

describe('Postgres call classes - construction + toOp parity', () => {
  it('CreateTableCall freezes, labels from the table name, and lowers to a createTable op', () => {
    const call = new CreateTableCall(
      'public',
      'user',
      [{ name: 'id', typeSql: 'text', defaultSql: '', nullable: false }],
      { columns: ['id'] },
    );

    expect(Object.isFrozen(call)).toBe(true);
    expect(call.factoryName).toBe('createTable');
    expect(call.operationClass).toBe('additive');
    expect(call.label).toBe('Create table "user"');

    expect(call.toOp()).toMatchObject({
      id: 'table.user',
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: { schema: 'public', objectType: 'table', name: 'user' },
      },
    });
  });

  it('DataTransformCall carries its slot names and a caller-supplied operationClass; toOp throws PN-MIG-2001', () => {
    const call = new DataTransformCall('Backfill', 'slot-check', 'slot-run', 'widening');

    expect(call.checkSlot).toBe('slot-check');
    expect(call.runSlot).toBe('slot-run');
    expect(call.operationClass).toBe('widening');

    expect(() => call.toOp()).toThrow(/Unfilled migration placeholder/);
  });
});
