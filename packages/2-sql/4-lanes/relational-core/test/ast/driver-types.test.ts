import { describe, expect, it } from 'vitest';
import type { SqlConnection, SqlDriver, SqlExecuteRequest } from '../../src/ast/driver-types';

function createMockDriverWithVoidBinding(): SqlDriver {
  const queryable = {
    async *execute(_request: SqlExecuteRequest) {
      yield { id: 1 };
    },
    query: async () => ({ rows: [] as ReadonlyArray<Record<string, unknown>>, rowCount: 0 }),
  };

  const transaction = {
    ...queryable,
    commit: async () => {},
    rollback: async () => {},
  } as unknown as Awaited<ReturnType<SqlConnection['beginTransaction']>>;

  const connection = {
    ...queryable,
    release: async () => {},
    beginTransaction: async () => transaction,
  } as unknown as SqlConnection;

  return {
    ...queryable,
    connect: async (_binding?: undefined) => {},
    acquireConnection: async () => connection,
    close: async () => {},
  } as unknown as SqlDriver;
}

describe('SqlDriver', () => {
  describe('connect with TBinding = void', () => {
    it('accepts undefined binding and resolves', async () => {
      const driver = createMockDriverWithVoidBinding();
      await expect(driver.connect(undefined)).resolves.toBeUndefined();
    });
  });
});
