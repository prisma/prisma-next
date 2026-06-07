/**
 * Construction-side coverage for the Postgres migration IR call classes:
 * each `*Call` constructs with literal args, freezes itself, computes its
 * label, and lowers to the matching runtime op via `toOp()`. Renders are
 * exercised separately in op-factory-call.rendering.test.ts; multi-call
 * lowering is covered in op-factory-call.lowering.test.ts.
 */

import {
  CreateSchemaCall,
  CreateTableCall,
  DataTransformCall,
} from '@prisma-next/target-postgres/op-factory-call';
import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../../src/core/adapter';

const testAdapter = createPostgresAdapter();
const testLower = (
  ast:
    | Parameters<typeof testAdapter.lower>[0]
    | import('@prisma-next/sql-relational-core/ast').DdlNode,
  ctx: import('@prisma-next/sql-relational-core/ast').LowererContext<unknown>,
) =>
  testAdapter.lower(
    ast as Parameters<typeof testAdapter.lower>[0],
    ctx as Parameters<typeof testAdapter.lower>[1],
  );

describe('Postgres call classes - construction + toOp parity', () => {
  it('CreateTableCall freezes, labels from the table name, and lowers to a createTable op', () => {
    const call = new CreateTableCall(
      'public',
      'user',
      [{ name: 'id', typeSql: 'text', defaultSql: '', columnDefault: undefined, nullable: false }],
      { columns: ['id'] },
    );

    expect(Object.isFrozen(call)).toBe(true);
    expect(call.factoryName).toBe('createTable');
    expect(call.operationClass).toBe('additive');
    expect(call.label).toBe('Create table "user"');

    expect(call.toOp(testLower)).toMatchObject({
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

  it('CreateTableCall.toOp produces byte-identical SQL for a composite-PK table (AC-3)', () => {
    const call = new CreateTableCall(
      'public',
      'item',
      [
        {
          name: 'tenant_id',
          typeSql: 'uuid',
          defaultSql: '',
          columnDefault: undefined,
          nullable: false,
        },
        { name: 'id', typeSql: 'uuid', defaultSql: '', columnDefault: undefined, nullable: false },
        {
          name: 'name',
          typeSql: 'text',
          defaultSql: '',
          columnDefault: undefined,
          nullable: false,
        },
      ],
      { columns: ['tenant_id', 'id'] },
    );

    const op = call.toOp(testLower);
    expect(op.execute[0]?.sql).toBe(
      'CREATE TABLE "public"."item" (\n' +
        '  "tenant_id" uuid NOT NULL,\n' +
        '  "id" uuid NOT NULL,\n' +
        '  "name" text NOT NULL,\n' +
        '  PRIMARY KEY ("tenant_id", "id")\n' +
        ')',
    );
  });

  it('CreateSchemaCall.toOp produces byte-identical SQL (AC-3)', () => {
    const call = new CreateSchemaCall('app');

    const op = call.toOp(testLower);
    expect(op.execute[0]?.sql).toBe('CREATE SCHEMA IF NOT EXISTS "app"');
  });

  it('CreateTableCall.toOp with a sequence default produces nextval SQL (byte-parity)', () => {
    const call = new CreateTableCall('public', 'user', [
      {
        name: 'id',
        typeSql: 'bigint',
        defaultSql: '',
        columnDefault: { kind: 'sequence', name: 'user_id_seq' },
        nullable: false,
      },
    ]);

    const op = call.toOp(testLower);
    expect(op.execute[0]?.sql).toBe(
      'CREATE TABLE "public"."user" (\n' +
        '  "id" bigint NOT NULL DEFAULT nextval(\'"user_id_seq"\'::regclass)\n' +
        ')',
    );
  });

  it('CreateTableCall.toOp with __unbound__ schema produces an unqualified table name', () => {
    const call = new CreateTableCall(
      '__unbound__',
      'item',
      [{ name: 'id', typeSql: 'text', defaultSql: '', columnDefault: undefined, nullable: false }],
      { columns: ['id'] },
    );

    const op = call.toOp(testLower);
    expect(op.execute[0]?.sql).toBe(
      'CREATE TABLE "item" (\n' + '  "id" text NOT NULL,\n' + '  PRIMARY KEY ("id")\n' + ')',
    );
  });
});
