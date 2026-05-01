import { coreHash } from '@prisma-next/contract/types';
import {
  codec,
  createCodecRegistry,
  ParamRef,
  RawSqlExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import { encodeParams } from '../src/codecs/encoding';

const TEST_HASH = coreHash('sha256:raw-sql-expr-encode');

describe('encodeParams over a RawSqlExpr-backed plan (AC-LOW4)', () => {
  it('runs async codec.encode for ParamRefs interpolated inside a RawSqlExpr AST', async () => {
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/async-text@1',
        targetTypes: ['text'],
        encode: async (value: string) => `wire:${value}`,
        decode: async (wire: string) => wire,
      }),
    );
    registry.register(
      codec({
        typeId: 'test/sync-int@1',
        targetTypes: ['int4'],
        encode: (value: number) => value * 10,
        decode: (wire: number) => wire,
      }),
    );

    const ast = RawSqlExpr.of(
      ['SELECT eql_v2.add_search_config(', ', ', ')'],
      [
        ParamRef.of('email', { codecId: 'test/async-text@1' }),
        ParamRef.of(7, { codecId: 'test/sync-int@1' }),
      ],
    );

    const plan: SqlExecutionPlan = {
      sql: 'SELECT eql_v2.add_search_config($1, $2)',
      params: ['email', 7],
      ast,
      meta: {
        target: 'postgres',
        storageHash: TEST_HASH,
        lane: 'raw',
      },
    };

    const encoded = await encodeParams(plan, registry, {});
    expect([...encoded]).toEqual(['wire:email', 70]);
  });
});
