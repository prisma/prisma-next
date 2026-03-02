import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKyselyLane } from './client';
import { REDACTED_SQL } from './plan';

const mocks = vi.hoisted(() => ({
  kyselyCtor: vi.fn(),
}));

vi.mock('kysely', () => ({
  Kysely: class {
    constructor(config: unknown) {
      mocks.kyselyCtor(config);
    }
  },
  PostgresAdapter: class {},
  PostgresQueryCompiler: class {
    compileQuery() {
      return { query: { kind: 'SelectQueryNode' }, sql: 'select 1', parameters: ['p1', 2] };
    }
  },
}));

const contract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  storageHash: 'sha256:test' as never,
  models: {},
  relations: {},
  storage: { tables: {} },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
};

describe('createKyselyLane', () => {
  beforeEach(() => {
    mocks.kyselyCtor.mockReset();
  });

  it('creates build-only lane surface', () => {
    const lane = createKyselyLane(contract);
    expect(mocks.kyselyCtor).toHaveBeenCalledTimes(1);
    expect(typeof lane.build).toBe('function');
    expect(typeof lane.whereExpr).toBe('function');
    expect(lane.redactedSql).toBe(REDACTED_SQL);
  });

  it('throws when execution is attempted', async () => {
    createKyselyLane(contract);
    const config = mocks.kyselyCtor.mock.calls[0]?.[0] as { dialect: { createDriver(): unknown } };
    const driver = config.dialect.createDriver() as { acquireConnection(): Promise<unknown> };
    await expect(driver.acquireConnection()).rejects.toThrow(
      /Kysely execution is disabled for db\.kysely/,
    );
  });

  it('redacts compiled sql and keeps parameters', () => {
    createKyselyLane(contract);
    const config = mocks.kyselyCtor.mock.calls[0]?.[0] as {
      dialect: {
        createQueryCompiler(): {
          compileQuery(node: unknown): { sql: string; parameters: unknown[] };
        };
      };
    };
    const compiler = config.dialect.createQueryCompiler();
    const compiled = compiler.compileQuery({ kind: 'SelectQueryNode' });
    expect(compiled).toMatchObject({ sql: REDACTED_SQL, parameters: ['p1', 2] });
  });
});
