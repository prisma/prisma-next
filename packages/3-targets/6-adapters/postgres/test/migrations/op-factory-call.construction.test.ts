/**
 * Construction-side coverage for the Postgres migration IR call classes:
 * each `*Call` constructs with literal args, freezes itself, computes its
 * label, and lowers to the matching runtime op via `toOp()`. Renders are
 * exercised separately in op-factory-call.rendering.test.ts; multi-call
 * lowering is covered in op-factory-call.lowering.test.ts.
 */

import { col, fn, primaryKey } from '@prisma-next/sql-relational-core/contract-free';
import {
  CreateSchemaCall,
  CreateTableCall,
  DataTransformCall,
} from '@prisma-next/target-postgres/op-factory-call';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-lookup';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

const testAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

describe('Postgres call classes - construction + toOp parity', () => {
  it('CreateTableCall freezes, labels from the table name, and lowers to a createTable op', async () => {
    const call = new CreateTableCall('public', 'user', [col('id', 'text', { notNull: true })]);

    expect(Object.isFrozen(call)).toBe(true);
    expect(call.factoryName).toBe('createTable');
    expect(call.operationClass).toBe('additive');
    expect(call.label).toBe('Create table "user"');

    expect(await call.toOp(testAdapter)).toMatchObject({
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

  it('CreateTableCall.toOp produces byte-identical SQL for a composite-PK table', async () => {
    const call = new CreateTableCall(
      'public',
      'item',
      [
        col('tenant_id', 'uuid', { notNull: true }),
        col('id', 'uuid', { notNull: true }),
        col('name', 'text', { notNull: true }),
      ],
      [primaryKey(['tenant_id', 'id'])],
    );

    const op = await call.toOp(testAdapter);
    expect(op.execute[0]?.sql).toBe(
      'CREATE TABLE "public"."item" (\n' +
        '  "tenant_id" uuid NOT NULL,\n' +
        '  "id" uuid NOT NULL,\n' +
        '  "name" text NOT NULL,\n' +
        '  PRIMARY KEY ("tenant_id", "id")\n' +
        ')',
    );
  });

  it('CreateSchemaCall.toOp produces byte-identical SQL', async () => {
    const call = new CreateSchemaCall('app');

    const op = await call.toOp(testAdapter);
    expect(op.execute[0]?.sql).toBe('CREATE SCHEMA IF NOT EXISTS "app"');
  });

  it('CreateTableCall.toOp with a sequence default produces nextval SQL (byte-parity)', async () => {
    const call = new CreateTableCall('public', 'user', [
      col('id', 'bigint', { notNull: true, default: fn(`nextval('"user_id_seq"'::regclass)`) }),
    ]);

    const op = await call.toOp(testAdapter);
    expect(op.execute[0]?.sql).toBe(
      'CREATE TABLE "public"."user" (\n' +
        `  "id" bigint NOT NULL DEFAULT (nextval('"user_id_seq"'::regclass))\n` +
        ')',
    );
  });

  it('CreateTableCall.toOp with __unbound__ schema produces an unqualified table name', async () => {
    const call = new CreateTableCall(
      '__unbound__',
      'item',
      [col('id', 'text', { notNull: true })],
      [primaryKey(['id'])],
    );

    const op = await call.toOp(testAdapter);
    expect(op.execute[0]?.sql).toBe(
      'CREATE TABLE "item" (\n' + '  "id" text NOT NULL,\n' + '  PRIMARY KEY ("id")\n' + ')',
    );
  });
});
