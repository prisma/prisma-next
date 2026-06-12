import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { col } from '@prisma-next/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import { tableExistsAst } from '../../src/contract-free/checks';
import { CreateTableCall } from '../../src/core/migrations/op-factory-call';

function recordingCheckLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({
        sql: `LOWERED ${received.length}`,
        params: Object.freeze([`p${received.length}`]),
      });
    },
  };
  return { lowerer, received };
}

describe('CreateTableCall', () => {
  it('lowers typed to_regclass checks into parameterized pre/postcheck steps', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new CreateTableCall('public', 'user', [col('id', 'integer', { notNull: true })]);
    const op = await call.toOp(lowerer);

    expect(received.slice(1)).toEqual([
      tableExistsAst('public', 'user').tableAbsent(),
      tableExistsAst('public', 'user').tablePresent(),
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure table "user" does not exist', sql: 'LOWERED 2', params: ['p2'] },
    ]);
    expect(op.execute).toEqual([
      { description: 'create table "user"', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify table "user" exists', sql: 'LOWERED 3', params: ['p3'] },
    ]);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateTableCall('public', 'user', [col('id', 'integer')]);
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });
});
