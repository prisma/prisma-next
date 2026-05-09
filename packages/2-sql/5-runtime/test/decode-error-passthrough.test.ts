import { coreHash } from '@prisma-next/contract/types';
import { runtimeAborted, runtimeError } from '@prisma-next/framework-components/runtime';
import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import { decodeRow } from '../src/codecs/decoding';
import { defineTestCodec } from './test-codec';
import { buildTestContractCodecs } from './utils';

const TEST_HASH = coreHash('sha256:test');

function buildPlan(): SqlExecutionPlan {
  const ast = SelectAst.from(TableSource.named('users')).withProjection([
    ProjectionItem.of('value', ColumnRef.of('users', 'value'), 'test/passthrough@1'),
  ]);
  return {
    sql: 'select value from users',
    params: [],
    ast,
    meta: {
      target: 'postgres',
      storageHash: TEST_HASH,
      lane: 'dsl',
    },
  };
}

describe('decodeRow — runtime-envelope passthrough (F40)', () => {
  it('rethrows codec-authored RUNTIME.DECODE_FAILED without wrapping', async () => {
    const original = runtimeError('RUNTIME.DECODE_FAILED', 'codec-authored failure', {
      table: 'users',
      column: 'value',
      codec: 'test/passthrough@1',
      detail: 'codec-specific',
    });
    const registry = [
      defineTestCodec({
        typeId: 'test/passthrough@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw original;
        },
      }),
    ];

    await expect(
      decodeRow({ value: 'wire' }, buildPlan(), {}, buildTestContractCodecs(registry)),
    ).rejects.toBe(original);
  });

  it('rethrows codec-authored RUNTIME.ABORTED without wrapping', async () => {
    const original = runtimeAborted('decode', new Error('codec aborted'));
    const registry = [
      defineTestCodec({
        typeId: 'test/passthrough@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw original;
        },
      }),
    ];

    await expect(
      decodeRow({ value: 'wire' }, buildPlan(), {}, buildTestContractCodecs(registry)),
    ).rejects.toBe(original);
  });

  it('wraps a foreign Error into RUNTIME.DECODE_FAILED with the original on cause', async () => {
    const original = new Error('boom');
    const registry = [
      defineTestCodec({
        typeId: 'test/passthrough@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: () => {
          throw original;
        },
      }),
    ];

    await expect(
      decodeRow({ value: 'wire' }, buildPlan(), {}, buildTestContractCodecs(registry)),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      cause: original,
      details: expect.objectContaining({
        table: 'users',
        column: 'value',
        codec: 'test/passthrough@1',
      }),
    });
  });
});
