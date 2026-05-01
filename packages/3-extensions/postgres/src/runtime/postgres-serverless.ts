import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriver, {
  type PostgresDriverCreateOptions,
} from '@prisma-next/driver-postgres/runtime';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type {
  ExecutionContext,
  Runtime,
  RuntimeVerifyOptions,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
} from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { ifDefined } from '@prisma-next/utils/defined';
import { Client } from 'pg';

import type { PostgresTargetId } from './postgres';

export type PostgresServerlessCursorOptions = NonNullable<PostgresDriverCreateOptions['cursor']>;

export interface PostgresServerlessClient<TContract extends Contract<SqlStorage>> {
  readonly sql: Db<TContract>;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
  readonly contract: TContract;
  connect(binding: { readonly url: string }): Promise<Runtime & AsyncDisposable>;
}

export interface PostgresServerlessOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verify?: RuntimeVerifyOptions;
  readonly cursor?: PostgresServerlessCursorOptions;
}

export type PostgresServerlessOptionsWithContract<TContract extends Contract<SqlStorage>> =
  PostgresServerlessOptionsBase & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

export type PostgresServerlessOptionsWithContractJson<TContract extends Contract<SqlStorage>> =
  PostgresServerlessOptionsBase & {
    readonly contractJson: unknown;
    readonly contract?: never;
    readonly _contract?: TContract;
  };

export type PostgresServerlessOptions<TContract extends Contract<SqlStorage>> =
  | PostgresServerlessOptionsWithContract<TContract>
  | PostgresServerlessOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends Contract<SqlStorage>>(
  options: PostgresServerlessOptions<TContract>,
): options is PostgresServerlessOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: PostgresServerlessOptions<TContract>,
): TContract {
  const contractInput = hasContractJson(options) ? options.contractJson : options.contract;
  return validateContract<TContract>(contractInput, emptyCodecLookup);
}

function validateConnectionString(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new Error('Postgres URL must be a non-empty string');
  }
  return trimmed;
}

/**
 * Per-request Postgres facade for serverless / edge runtimes (Cloudflare Workers + Hyperdrive,
 * AWS Lambda, Vercel, Deno Deploy, Bun edge, etc.).
 *
 * Construction shape mirrors the Node `postgres()` factory but the returned client deliberately
 * omits `orm`, `runtime()`, and `transaction()`. Closure-cached convenience surfaces are unsafe
 * across `fetch` invocations: stale connections after isolate idle, concurrent-query races on a
 * shared `pg.Client`, no clean shutdown. Per-request callers acquire a fresh `Runtime` via
 * `db.connect({ url })` and dispose it via `await using` on scope exit.
 *
 * @example
 * ```ts
 * const db = postgresServerless<Contract>({ contractJson });
 *
 * export default {
 *   async fetch(_req: Request, env: Env): Promise<Response> {
 *     await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });
 *     const rows = await runtime.execute(db.sql.from(t).select(...).build());
 *     return Response.json(rows);
 *   },
 * };
 * ```
 */
export default function postgresServerless<TContract extends Contract<SqlStorage>>(
  options: PostgresServerlessOptionsWithContract<TContract>,
): PostgresServerlessClient<TContract>;
export default function postgresServerless<TContract extends Contract<SqlStorage>>(
  options: PostgresServerlessOptionsWithContractJson<TContract>,
): PostgresServerlessClient<TContract>;
export default function postgresServerless<TContract extends Contract<SqlStorage>>(
  options: PostgresServerlessOptions<TContract>,
): PostgresServerlessClient<TContract> {
  const contract = resolveContract(options);
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: options.extensions ?? [],
  });

  const context = createExecutionContext({
    contract,
    stack,
  });

  const sql: Db<TContract> = sqlBuilder<TContract>({ context });

  return {
    sql,
    context,
    stack,
    contract,

    async connect(binding) {
      const url = validateConnectionString(binding.url);

      const driverDescriptor = stack.driver;
      if (!driverDescriptor) {
        throw new Error('Driver descriptor missing from execution stack');
      }

      const stackInstance = instantiateExecutionStack(stack);
      const driver = driverDescriptor.create({
        ...ifDefined('cursor', options.cursor),
      });

      const client = new Client({ connectionString: url });
      await driver.connect({ kind: 'pgClient', client });

      const runtime = createRuntime({
        stackInstance,
        context,
        driver,
        verify: options.verify ?? { mode: 'onFirstUse', requireMarker: false },
        ...ifDefined('middleware', options.middleware),
      });

      Object.defineProperty(runtime, Symbol.asyncDispose, {
        value: () => runtime.close(),
        configurable: true,
        writable: false,
        enumerable: false,
      });

      return runtime as Runtime & AsyncDisposable;
    },
  };
}
