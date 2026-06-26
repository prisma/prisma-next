import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
} from '@prisma-next/framework-components/runtime';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { orm } from '@prisma-next/sql-orm-client';
import type { RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import { createRawSql } from '@prisma-next/sql-relational-core/expression';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type {
  ExecutionContext,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  TransactionContext,
  VerifyMarkerOption,
} from '@prisma-next/sql-runtime';
import {
  createExecutionContext,
  createSqlExecutionStack,
  withTransaction,
} from '@prisma-next/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { createRemoteJWKSet, type JWTVerifyResult, jwtVerify } from 'jose';
import type { Client } from 'pg';
import { Pool } from 'pg';
import { supabaseRuntimeDescriptor } from './descriptor';
import type { SupabaseRoleBinding, SupabaseRuntime } from './supabase-runtime';
import { SupabaseRuntimeImpl } from './supabase-runtime';

export type SupabaseTargetId = 'postgres';

type OrmClient<TContract extends Contract<SqlStorage>> = ReturnType<typeof orm<TContract>>;

export class SupabaseConfigError extends Error {
  override readonly name = 'SupabaseConfigError';
  constructor(message: string) {
    super(message);
  }
}

export class InvalidJwtError extends Error {
  override readonly name = 'InvalidJwtError';
  readonly reason: string;
  constructor(reason: string) {
    super(`Invalid JWT: ${reason}`);
    this.reason = reason;
  }
}

type KeyMaterial =
  | { readonly kind: 'secret'; readonly key: Uint8Array }
  | { readonly kind: 'jwks'; readonly keyset: ReturnType<typeof createRemoteJWKSet> };

export interface RoleBoundDb<TContract extends Contract<SqlStorage>> {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract>;
  readonly raw: RawSqlTag;
  execute<Row>(
    plan: (SqlExecutionPlan<Row> | SqlQueryPlan<Row>) & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
  transaction<R>(fn: (tx: TransactionContext) => PromiseLike<R>): Promise<R>;
}

export interface SupabaseDb<TContract extends Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<SupabaseTargetId>;
  asUser(jwt: string): Promise<RoleBoundDb<TContract>>;
  asAnon(): RoleBoundDb<TContract>;
  asServiceRole(): RoleBoundDb<TContract>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface SupabaseOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<SupabaseTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
  readonly poolOptions?: {
    readonly connectionTimeoutMillis?: number;
    readonly idleTimeoutMillis?: number;
  };
}

export interface SupabaseBindingOptions {
  readonly url?: string;
  readonly pg?: Pool | Client;
}

type JwtSecretOption = {
  readonly jwtSecret: string;
  readonly jwksUrl?: never;
};

type JwksUrlOption = {
  readonly jwksUrl: string;
  readonly jwtSecret?: never;
};

export type SupabaseOptionsWithContract<TContract extends Contract<SqlStorage>> =
  SupabaseBindingOptions &
    SupabaseOptionsBase &
    (JwtSecretOption | JwksUrlOption) & {
      readonly contract: TContract;
      readonly contractJson?: never;
    };

export type SupabaseOptionsWithContractJson<TContract extends Contract<SqlStorage>> =
  SupabaseBindingOptions &
    SupabaseOptionsBase &
    (JwtSecretOption | JwksUrlOption) & {
      readonly contractJson: unknown;
      readonly contract?: never;
      readonly _contract?: TContract;
    };

export type SupabaseOptions<TContract extends Contract<SqlStorage>> =
  | SupabaseOptionsWithContract<TContract>
  | SupabaseOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptions<TContract>,
): options is SupabaseOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

const contractSerializer = new PostgresContractSerializer();

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptions<TContract>,
): TContract {
  const contractJson = hasContractJson(options)
    ? options.contractJson
    : contractSerializer.serializeContract(options.contract);
  return blindCast<
    TContract,
    'contractSerializer.deserializeContract returns a validated TContract'
  >(contractSerializer.deserializeContract(contractJson));
}

function resolveKeyMaterial<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptions<TContract>,
): KeyMaterial {
  const jwtSecret = 'jwtSecret' in options ? options.jwtSecret : undefined;
  const jwksUrl = 'jwksUrl' in options ? options.jwksUrl : undefined;

  if (jwtSecret !== undefined && jwksUrl !== undefined) {
    throw new SupabaseConfigError('Provide either jwtSecret or jwksUrl, not both');
  }
  if (jwtSecret === undefined && jwksUrl === undefined) {
    throw new SupabaseConfigError('Either jwtSecret or jwksUrl is required');
  }

  if (jwtSecret !== undefined) {
    return { kind: 'secret', key: new TextEncoder().encode(jwtSecret) };
  }

  if (jwksUrl !== undefined) {
    return { kind: 'jwks', keyset: createRemoteJWKSet(new URL(jwksUrl)) };
  }

  throw new SupabaseConfigError('Either jwtSecret or jwksUrl is required');
}

function toPool<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptions<TContract>,
): { pool: Pool; owned: boolean } | undefined {
  if (options.pg instanceof Pool) {
    return { pool: options.pg, owned: false };
  }
  if (typeof options.url === 'string') {
    return {
      pool: new Pool({
        connectionString: options.url,
        connectionTimeoutMillis: options.poolOptions?.connectionTimeoutMillis ?? 20_000,
        idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
      }),
      owned: true,
    };
  }
  return undefined;
}

function withSupabaseDescriptor(
  extensions: readonly SqlRuntimeExtensionDescriptor<SupabaseTargetId>[] | undefined,
): readonly SqlRuntimeExtensionDescriptor<SupabaseTargetId>[] {
  const packs = extensions ?? [];
  return packs.some((pack) => pack.id === supabaseRuntimeDescriptor.id)
    ? packs
    : [...packs, supabaseRuntimeDescriptor];
}

export default async function supabase<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptionsWithContract<TContract>,
): Promise<SupabaseDb<TContract>>;
export default async function supabase<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptionsWithContractJson<TContract>,
): Promise<SupabaseDb<TContract>>;
export default async function supabase<TContract extends Contract<SqlStorage>>(
  options: SupabaseOptions<TContract>,
): Promise<SupabaseDb<TContract>> {
  const keyMaterial = resolveKeyMaterial(options);
  const contract = resolveContract(options);

  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: withSupabaseDescriptor(options.extensions),
  });

  const context = createExecutionContext({ contract, stack });
  const rawCodecInferer = stack.adapter.rawCodecInferer;
  const rawSqlTag: RawSqlTag = createRawSql(rawCodecInferer);

  const poolEntry = toPool(options);
  let closed = false;

  const stackInstance = instantiateExecutionStack(stack);
  const driverDescriptor = stack.driver;
  if (!driverDescriptor) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  const driver = driverDescriptor.create({ cursor: { disabled: true } });

  if (poolEntry) {
    await driver.connect({ kind: 'pgPool', pool: poolEntry.pool });
  }

  const runtime: SupabaseRuntime & SupabaseRuntimeImpl<TContract> = new SupabaseRuntimeImpl({
    context,
    adapter: stackInstance.adapter,
    driver,
    ...ifDefined('verifyMarker', options.verifyMarker),
    ...ifDefined('middleware', options.middleware),
  });

  async function verifyJwt(jwt: string): Promise<JWTVerifyResult> {
    try {
      if (keyMaterial.kind === 'secret') {
        return await jwtVerify(jwt, keyMaterial.key);
      }
      return await jwtVerify(jwt, keyMaterial.keyset);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new InvalidJwtError(reason);
    }
  }

  function buildRoleBoundDb(binding: SupabaseRoleBinding): RoleBoundDb<TContract> {
    const roleSql: Db<TContract> = sql<TContract>({ context, rawCodecInferer });
    const roleOrm: OrmClient<TContract> = orm({
      runtime: {
        execute(plan) {
          return runtime.executeWithRole(plan, binding);
        },
        // connection() returns a role session; this is the enforcement path for ORM scope
        // operations (mutations, includes) — every statement runs role-bound.
        connection: () => runtime.openRoleSession(binding),
      },
      context,
    });

    return {
      sql: roleSql,
      orm: roleOrm,
      raw: rawSqlTag,
      execute<Row>(
        plan: (SqlExecutionPlan<Row> | SqlQueryPlan<Row>) & { readonly _row?: Row },
        execOptions?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return runtime.executeWithRole<Row>(plan, binding, execOptions);
      },
      transaction<R>(fn: (tx: TransactionContext) => PromiseLike<R>): Promise<R> {
        return withTransaction({ connection: () => runtime.openRoleSession(binding) }, fn);
      },
    };
  }

  async function closeDb(): Promise<void> {
    if (closed) return;
    closed = true;
    await runtime.close();
    if (poolEntry?.owned) {
      await poolEntry.pool.end().catch(() => undefined);
    }
  }

  return {
    context,
    stack,

    async asUser(jwt: string): Promise<RoleBoundDb<TContract>> {
      const { payload } = await verifyJwt(jwt);
      const rawRole = payload['role'];
      const roleStr = typeof rawRole === 'string' ? rawRole : 'authenticated';
      const role: SupabaseRoleBinding['role'] =
        roleStr === 'anon' || roleStr === 'authenticated' || roleStr === 'service_role'
          ? roleStr
          : 'authenticated';
      const binding: SupabaseRoleBinding = { role, claims: payload };
      return buildRoleBoundDb(binding);
    },

    asAnon(): RoleBoundDb<TContract> {
      return buildRoleBoundDb({ role: 'anon', claims: {} });
    },

    asServiceRole(): RoleBoundDb<TContract> {
      return buildRoleBoundDb({ role: 'service_role', claims: {} });
    },

    close: closeDb,
    [Symbol.asyncDispose]: closeDb,
  };
}
