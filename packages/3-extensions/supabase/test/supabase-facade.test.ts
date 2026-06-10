import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { createContract } from '@prisma-next/test-utils';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  instantiateExecutionStack: vi.fn(),
  SupabaseRuntime: vi.fn(),
  runtimeInstances: [] as unknown[],
  createExecutionContext: vi.fn(),
  createSqlExecutionStack: vi.fn(),
  driverCreate: vi.fn(),
  driverConnect: vi.fn(),
  deserializeContract: vi.fn(),
  poolCtor: vi.fn(),
  sqlBuilder: vi.fn(),
  orm: vi.fn(),
  executeWithRole: vi.fn(),
  executeRoleTransaction: vi.fn(),
  connection: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@prisma-next/framework-components/execution', () => ({
  instantiateExecutionStack: mocks.instantiateExecutionStack,
}));

vi.mock('@prisma-next/sql-runtime', () => ({
  createExecutionContext: mocks.createExecutionContext,
  createSqlExecutionStack: mocks.createSqlExecutionStack,
}));

vi.mock('../src/runtime/supabase-runtime', () => ({
  SupabaseRuntime: class {
    constructor(options: unknown) {
      Object.assign(this, mocks.SupabaseRuntime(options));
      mocks.runtimeInstances.push(this);
    }
  },
}));

vi.mock('@prisma-next/sql-builder/runtime', () => ({
  sql: mocks.sqlBuilder,
}));

vi.mock('@prisma-next/sql-orm-client', () => ({
  orm: mocks.orm,
}));

vi.mock('@prisma-next/target-postgres/runtime', () => ({
  default: { id: 'target-postgres' },
  PostgresContractSerializer: class {
    deserializeContract(value: unknown) {
      return mocks.deserializeContract(value);
    }
  },
}));

vi.mock('@prisma-next/adapter-postgres/runtime', () => ({
  default: { id: 'adapter-postgres', rawCodecInferer: { inferCodec: () => 'pg/text' } },
}));

vi.mock('@prisma-next/driver-postgres/runtime', () => ({
  default: { id: 'driver-postgres' },
}));

vi.mock('pg', () => {
  class Pool {
    constructor(options: unknown) {
      mocks.poolCtor(options);
    }
  }
  class Client {}
  return { Pool, Client };
});

import supabase, { InvalidJwtError, SupabaseConfigError } from '../src/runtime/supabase';

const contract = createContract<SqlStorage>();

const JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256';

async function makeJwt(
  payload: Record<string, unknown>,
  secret = JWT_SECRET,
  expiresIn = '1h',
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(key);
}

describe('supabase() factory', () => {
  beforeEach(() => {
    mocks.instantiateExecutionStack.mockReset();
    mocks.SupabaseRuntime.mockReset();
    mocks.runtimeInstances.length = 0;
    mocks.createExecutionContext.mockReset();
    mocks.createSqlExecutionStack.mockReset();
    mocks.driverCreate.mockReset();
    mocks.driverConnect.mockReset();
    mocks.deserializeContract.mockReset();
    mocks.poolCtor.mockReset();
    mocks.sqlBuilder.mockReset();
    mocks.orm.mockReset();
    mocks.executeWithRole.mockReset();
    mocks.executeRoleTransaction.mockReset();
    mocks.connection.mockReset();
    mocks.close.mockReset();

    mocks.createExecutionContext.mockReturnValue({ contract });
    mocks.createSqlExecutionStack.mockReturnValue({
      target: { id: 'target-postgres' },
      adapter: {
        id: 'adapter-postgres',
        rawCodecInferer: { inferCodec: () => 'pg/text' },
        create: () => ({}),
      },
      driver: { create: mocks.driverCreate },
      extensionPacks: [],
    });
    mocks.instantiateExecutionStack.mockReturnValue({ adapter: {} });
    mocks.driverConnect.mockResolvedValue(undefined);
    mocks.driverCreate.mockReturnValue({
      id: 'driver-instance',
      connect: mocks.driverConnect,
    });
    mocks.SupabaseRuntime.mockReturnValue({
      executeWithRole: mocks.executeWithRole,
      executeRoleTransaction: mocks.executeRoleTransaction,
      connection: mocks.connection,
      close: mocks.close,
    });
    mocks.deserializeContract.mockReturnValue(contract);
    mocks.sqlBuilder.mockReturnValue({ lane: 'sql' });
    mocks.orm.mockReturnValue({ lane: 'orm' });
    mocks.executeWithRole.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      [Symbol.asyncIterator]: async function* () {},
    });
    mocks.executeRoleTransaction.mockImplementation(
      async (_binding: unknown, fn: (tx: unknown) => unknown) => fn({}),
    );
  });

  describe('config validation', () => {
    it('rejects with SupabaseConfigError when both jwtSecret and jwksUrl are provided', async () => {
      await expect(
        supabase({
          contract,
          jwtSecret: JWT_SECRET,
          jwksUrl: 'https://example.com/.well-known/jwks.json',
        } as unknown as Parameters<typeof supabase<typeof contract>>[0]),
      ).rejects.toThrow(SupabaseConfigError);
    });

    it('rejects with SupabaseConfigError when neither jwtSecret nor jwksUrl is provided', async () => {
      await expect(
        supabase({
          contract,
        } as unknown as Parameters<typeof supabase<typeof contract>>[0]),
      ).rejects.toThrow(SupabaseConfigError);
    });
  });

  describe('asUser', () => {
    it('resolves with a RoleBoundDb for a valid HS256 JWT', async () => {
      const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' });
      const db = await supabase({ contract, jwtSecret: JWT_SECRET });

      const roleBoundDb = await db.asUser(jwt);

      expect(roleBoundDb).toBeDefined();
      expect(roleBoundDb.sql).toBeDefined();
      expect(roleBoundDb.orm).toBeDefined();
    });

    it('routes the full JWT payload as claims in the role binding', async () => {
      const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated', email: 'u@example.com' });
      const db = await supabase({ contract, jwtSecret: JWT_SECRET });

      const roleBoundDb = await db.asUser(jwt);
      await roleBoundDb
        .execute({
          sql: 'select 1',
          params: [],
          meta: { target: 'postgres', targetFamily: 'sql', storageHash: 'sha256:x', lane: 'raw' },
        } as unknown as Parameters<typeof roleBoundDb.execute>[0])
        .toArray();

      expect(mocks.executeWithRole).toHaveBeenCalledOnce();
      const [, binding] = mocks.executeWithRole.mock.calls[0] as [
        unknown,
        { role: string; claims: Record<string, unknown> },
      ];
      expect(binding.role).toBe('authenticated');
      expect(binding.claims['sub']).toBe('user-1');
      expect(binding.claims['email']).toBe('u@example.com');
    });

    it('rejects with InvalidJwtError for a JWT signed with the wrong secret', async () => {
      const jwt = await makeJwt(
        { sub: 'user-1', role: 'authenticated' },
        'wrong-secret-that-is-long-enough',
      );
      const db = await supabase({ contract, jwtSecret: JWT_SECRET });

      await expect(db.asUser(jwt)).rejects.toThrow(InvalidJwtError);
      expect(mocks.executeWithRole).not.toHaveBeenCalled();
    });

    it('rejects with InvalidJwtError for an expired JWT', async () => {
      const jwt = await makeJwt({ sub: 'user-1', role: 'authenticated' }, JWT_SECRET, '-1s');
      const db = await supabase({ contract, jwtSecret: JWT_SECRET });

      await expect(db.asUser(jwt)).rejects.toThrow(InvalidJwtError);
      expect(mocks.executeWithRole).not.toHaveBeenCalled();
    });

    it('never touches the driver/runtime when JWT validation fails', async () => {
      const jwt = await makeJwt({ sub: 'user-1' }, 'wrong-secret-that-is-long-enough');
      const db = await supabase({ contract, jwtSecret: JWT_SECRET });

      await expect(db.asUser(jwt)).rejects.toThrow(InvalidJwtError);
      expect(mocks.executeRoleTransaction).not.toHaveBeenCalled();
    });
  });

  describe('asAnon', () => {
    it('returns a RoleBoundDb with role anon and empty claims', async () => {
      const db = await supabase({ contract, jwtSecret: JWT_SECRET });

      const roleBoundDb = db.asAnon();
      await roleBoundDb
        .execute({
          sql: 'select 1',
          params: [],
          meta: { target: 'postgres', targetFamily: 'sql', storageHash: 'sha256:x', lane: 'raw' },
        } as unknown as Parameters<typeof roleBoundDb.execute>[0])
        .toArray();

      expect(mocks.executeWithRole).toHaveBeenCalledOnce();
      const [, binding] = mocks.executeWithRole.mock.calls[0] as [
        unknown,
        { role: string; claims: Record<string, unknown> },
      ];
      expect(binding).toEqual({ role: 'anon', claims: {} });
    });
  });

  describe('asServiceRole', () => {
    it('returns a RoleBoundDb with role service_role and empty claims', async () => {
      const db = await supabase({ contract, jwtSecret: JWT_SECRET });

      const roleBoundDb = db.asServiceRole();
      await roleBoundDb
        .execute({
          sql: 'select 1',
          params: [],
          meta: { target: 'postgres', targetFamily: 'sql', storageHash: 'sha256:x', lane: 'raw' },
        } as unknown as Parameters<typeof roleBoundDb.execute>[0])
        .toArray();

      expect(mocks.executeWithRole).toHaveBeenCalledOnce();
      const [, binding] = mocks.executeWithRole.mock.calls[0] as [
        unknown,
        { role: string; claims: Record<string, unknown> },
      ];
      expect(binding).toEqual({ role: 'service_role', claims: {} });
    });
  });

  describe('SupabaseDb surface', () => {
    it('has no top-level sql or orm properties', async () => {
      const db = await supabase({ contract, jwtSecret: JWT_SECRET });

      const dbAny = db as unknown as Record<string, unknown>;
      expect(dbAny['sql']).toBeUndefined();
      expect(dbAny['orm']).toBeUndefined();
    });

    it('has context and stack on the top-level db', async () => {
      const db = await supabase({ contract, jwtSecret: JWT_SECRET });

      expect(db.context).toBeDefined();
      expect(db.stack).toBeDefined();
    });
  });

  describe('RoleBoundDb routing', () => {
    it('execute routes to executeWithRole with the bound role', async () => {
      const db = await supabase({ contract, jwtSecret: JWT_SECRET });
      const roleBoundDb = db.asAnon();
      const plan = {
        sql: 'select 1',
        params: [],
        meta: { target: 'postgres', targetFamily: 'sql', storageHash: 'sha256:x', lane: 'raw' },
      } as unknown as Parameters<typeof roleBoundDb.execute>[0];

      await roleBoundDb.execute(plan).toArray();

      expect(mocks.executeWithRole).toHaveBeenCalledOnce();
      const [calledPlan, calledBinding] = mocks.executeWithRole.mock.calls[0] as [
        unknown,
        { role: string },
      ];
      expect(calledPlan).toBe(plan);
      expect(calledBinding.role).toBe('anon');
    });

    it('transaction routes to executeRoleTransaction with the bound role', async () => {
      const db = await supabase({ contract, jwtSecret: JWT_SECRET });
      const roleBoundDb = db.asServiceRole();
      const txFn = vi.fn().mockResolvedValue('result');

      const result = await roleBoundDb.transaction(txFn);

      expect(mocks.executeRoleTransaction).toHaveBeenCalledOnce();
      const [calledBinding] = mocks.executeRoleTransaction.mock.calls[0] as [{ role: string }];
      expect(calledBinding.role).toBe('service_role');
      expect(result).toBe('result');
    });
  });
});
