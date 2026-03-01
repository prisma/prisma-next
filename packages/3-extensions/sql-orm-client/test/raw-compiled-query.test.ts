import type { ContractBase } from '@prisma-next/contract/types';
import type { CompiledQuery } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { executeCompiledQuery } from '../src/raw-compiled-query';

const baseContract = {
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: 'storage-hash',
} as unknown as ContractBase;

describe('raw compiled query execution', () => {
  it('uses raw lane and omits profileHash by default', () => {
    const execute = vi.fn();
    const executor = { execute };

    const compiledQuery = {
      sql: 'select 1',
      parameters: [1, 'x'],
    } as unknown as CompiledQuery<unknown>;

    executeCompiledQuery(executor, baseContract, compiledQuery);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual({
      ast: undefined,
      sql: 'select 1',
      params: [1, 'x'],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'storage-hash',
        lane: 'raw',
        paramDescriptors: [],
      },
    });
  });

  it('forwards profileHash and custom lane when provided', () => {
    const execute = vi.fn();
    const executor = { execute };
    const contract = {
      ...baseContract,
      profileHash: 'profile-hash',
    } as unknown as ContractBase;

    executeCompiledQuery(
      executor,
      contract,
      {
        sql: 'select 2',
        parameters: [],
      } as unknown as CompiledQuery<unknown>,
      { lane: 'kysely' },
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      meta: {
        profileHash: 'profile-hash',
        lane: 'kysely',
      },
    });
  });
});
