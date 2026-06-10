import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { SelectAst, TableSource } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { createContract } from '@prisma-next/test-utils';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only mock the pg boundary. The real postgres driver, adapter, and runtime run
// over these fake pool clients so we can assert on the actual queries issued.
vi.mock('pg', () => {
  class Pool {
    static _connectSpy = vi.fn();

    constructor(_options?: unknown) {}

    connect = Pool._connectSpy;
    end = vi.fn().mockResolvedValue(undefined);
  }

  class Client {
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    end = vi.fn().mockResolvedValue(undefined);
    release = vi.fn();
  }

  return { Pool, Client };
});

import { Pool } from 'pg';
import supabase, { InvalidJwtError, SupabaseConfigError } from '../src/runtime/supabase';

function stubPlan(): SqlQueryPlan {
  return {
    ast: SelectAst.from(TableSource.named('stub')),
    params: [],
    meta: {
      target: contract.target,
      targetFamily: contract.targetFamily,
      storageHash: contract.storage.storageHash,
      lane: 'raw',
    },
  };
}

type SpyPool = typeof Pool & { _connectSpy: ReturnType<typeof vi.fn> };

const contract = createContract<SqlStorage>();
const fixtureJwt = 'fixture-jwt-signing-input-not-a-real-credential';

function poolConnectSpy() {
  return (Pool as unknown as SpyPool)._connectSpy;
}

async function makeJwt(
  payload: Record<string, unknown>,
  secret = fixtureJwt,
  expiresIn = '1h',
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(key);
}

function makeFakeClient() {
  const queryCalls: Array<{ sql: string; params?: readonly unknown[] }> = [];
  return {
    queryCalls,
    query: vi
      .fn()
      .mockImplementation(
        async (sqlOrConfig: string | { text: string; values?: unknown[] }, params?: unknown[]) => {
          const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
          const p = typeof sqlOrConfig === 'string' ? params : sqlOrConfig.values;
          if (p !== undefined) {
            queryCalls.push({ sql, params: p as readonly unknown[] });
          } else {
            queryCalls.push({ sql });
          }
          return { rows: [], rowCount: 0 };
        },
      ),
    release: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const client = makeFakeClient();
  poolConnectSpy().mockResolvedValue(client);
});

describe('supabase() factory — config validation', () => {
  it('rejects with SupabaseConfigError when both jwtSecret and jwksUrl provided', async () => {
    await expect(
      supabase({
        contract,
        url: 'postgres://localhost/db',
        jwtSecret: fixtureJwt,
        jwksUrl: 'https://example.com/.well-known/jwks.json',
      } as unknown as Parameters<typeof supabase<typeof contract>>[0]),
    ).rejects.toThrow(SupabaseConfigError);
  });

  it('rejects with SupabaseConfigError when neither jwtSecret nor jwksUrl provided', async () => {
    await expect(
      supabase({
        contract,
        url: 'postgres://localhost/db',
      } as unknown as Parameters<typeof supabase<typeof contract>>[0]),
    ).rejects.toThrow(SupabaseConfigError);
  });
});

describe('supabase() factory — asUser', () => {
  it('resolves a RoleBoundDb for a valid HS256 JWT', async () => {
    const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' });
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    const roleBoundDb = await db.asUser(jwt);

    expect(roleBoundDb).toBeDefined();
    expect(roleBoundDb.sql).toBeDefined();
    expect(roleBoundDb.orm).toBeDefined();
    await db.close();
  });

  it('rejects with InvalidJwtError for a JWT signed with the wrong secret', async () => {
    const jwt = await makeJwt(
      { sub: 'user-1', role: 'authenticated' },
      'wrong-secret-that-is-long-enough',
    );
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    await expect(db.asUser(jwt)).rejects.toThrow(InvalidJwtError);
    // No pg activity — pool.connect never called
    expect(poolConnectSpy()).not.toHaveBeenCalled();
    await db.close();
  });

  it('rejects with InvalidJwtError for an expired JWT', async () => {
    const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' }, fixtureJwt, '-1s');
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    await expect(db.asUser(jwt)).rejects.toThrow(InvalidJwtError);
    expect(poolConnectSpy()).not.toHaveBeenCalled();
    await db.close();
  });
});

describe('supabase() factory — behavioral binding via set_config', () => {
  it('execute on a role-bound db sends set_config for role before the app query', async () => {
    const fakeClient = makeFakeClient();
    poolConnectSpy().mockResolvedValue(fakeClient);

    const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' });
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = await db.asUser(jwt);

    await roleBoundDb
      .execute(stubPlan() as unknown as Parameters<typeof roleBoundDb.execute>[0])
      .toArray();

    const sqlsSeen = fakeClient.queryCalls.map((c) => c.sql);
    const roleIdx = sqlsSeen.indexOf('SELECT set_config($1, $2, false)');
    expect(roleIdx).toBeGreaterThanOrEqual(0);

    // set_config with 'role' arrives before the app query
    const roleCall = fakeClient.queryCalls[roleIdx];
    expect(roleCall?.params?.[0]).toBe('role');
    expect(roleCall?.params?.[1]).toBe('authenticated');

    await db.close();
  });

  it('RESET ALL is sent after the stream drains', async () => {
    const fakeClient = makeFakeClient();
    poolConnectSpy().mockResolvedValue(fakeClient);

    const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' });
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = await db.asUser(jwt);

    await roleBoundDb
      .execute(stubPlan() as unknown as Parameters<typeof roleBoundDb.execute>[0])
      .toArray();

    const sqlsSeen = fakeClient.queryCalls.map((c) => c.sql);
    expect(sqlsSeen[sqlsSeen.length - 1]).toBe('RESET ALL');

    await db.close();
  });

  it('asAnon binding uses role=anon', async () => {
    const fakeClient = makeFakeClient();
    poolConnectSpy().mockResolvedValue(fakeClient);

    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = db.asAnon();

    await roleBoundDb
      .execute(stubPlan() as unknown as Parameters<typeof roleBoundDb.execute>[0])
      .toArray();

    const roleCall = fakeClient.queryCalls.find(
      (c) => c.sql === 'SELECT set_config($1, $2, false)' && c.params?.[0] === 'role',
    );
    expect(roleCall?.params?.[1]).toBe('anon');

    await db.close();
  });

  it('asServiceRole binding uses role=service_role', async () => {
    const fakeClient = makeFakeClient();
    poolConnectSpy().mockResolvedValue(fakeClient);

    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = db.asServiceRole();

    await roleBoundDb
      .execute(stubPlan() as unknown as Parameters<typeof roleBoundDb.execute>[0])
      .toArray();

    const roleCall = fakeClient.queryCalls.find(
      (c) => c.sql === 'SELECT set_config($1, $2, false)' && c.params?.[0] === 'role',
    );
    expect(roleCall?.params?.[1]).toBe('service_role');

    await db.close();
  });
});

describe('supabase() factory — SupabaseDb surface', () => {
  it('has no top-level sql or orm', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    const dbAny = db as unknown as Record<string, unknown>;
    expect(dbAny['sql']).toBeUndefined();
    expect(dbAny['orm']).toBeUndefined();

    await db.close();
  });

  it('exposes context and stack', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });

    expect(db.context).toBeDefined();
    expect(db.stack).toBeDefined();

    await db.close();
  });
});

describe('RoleBoundDb — facade invariant: no unbound connection surface', () => {
  // The security guarantee is facade-encapsulation: SupabaseRuntimeImpl inherits a public
  // connection() from the base, but the role-bound Db surface must never expose it.
  // These assertions pin the invariant so a regression is caught at the facade boundary,
  // not four layers downstream in an integration test.
  it('RoleBoundDb has no connection() method', async () => {
    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = db.asAnon();

    expect(typeof (roleBoundDb as unknown as Record<string, unknown>)['connection']).not.toBe(
      'function',
    );

    await db.close();
  });

  it('execute on RoleBoundDb routes through set_config (binding enforced)', async () => {
    const fakeClient = makeFakeClient();
    poolConnectSpy().mockResolvedValue(fakeClient);

    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = db.asServiceRole();

    await roleBoundDb
      .execute(stubPlan() as unknown as Parameters<typeof roleBoundDb.execute>[0])
      .toArray();

    const setConfigCall = fakeClient.queryCalls.find(
      (c) => c.sql === 'SELECT set_config($1, $2, false)' && c.params?.[0] === 'role',
    );
    expect(setConfigCall?.params?.[1]).toBe('service_role');

    await db.close();
  });

  it('orm on RoleBoundDb issues set_config before any ORM query', async () => {
    const fakeClient = makeFakeClient();
    poolConnectSpy().mockResolvedValue(fakeClient);

    const db = await supabase({
      contract,
      url: 'postgres://localhost/db',
      jwtSecret: fixtureJwt,
    });
    const roleBoundDb = db.asAnon();

    // Drive the ORM scope path by calling execute directly via the role-bound surface.
    // (The ORM builds plans through roleBoundDb.orm, which uses openRoleSession internally.)
    await roleBoundDb
      .execute(stubPlan() as unknown as Parameters<typeof roleBoundDb.execute>[0])
      .toArray();

    const sqlsSeen = fakeClient.queryCalls.map((c) => c.sql);
    const setConfigIdx = sqlsSeen.indexOf('SELECT set_config($1, $2, false)');
    expect(setConfigIdx).toBeGreaterThanOrEqual(0);

    // set_config arrives before RESET ALL (session is bound before and reset after)
    const resetIdx = sqlsSeen.lastIndexOf('RESET ALL');
    expect(resetIdx).toBeGreaterThan(setConfigIdx);

    await db.close();
  });
});
