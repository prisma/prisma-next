import type { Contract } from '@prisma-next/contract/types';
import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
} from '@prisma-next/framework-components/runtime';
import { PostgresRuntime } from '@prisma-next/postgres/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { RawSessionConnection, TransactionContext } from '@prisma-next/sql-runtime';

export interface SupabaseRoleBinding {
  readonly role: 'anon' | 'authenticated' | 'service_role';
  readonly claims?: Record<string, unknown>;
}

/**
 * Supabase runtime. Extends `PostgresRuntime` with role-scoped execute methods
 * that apply a Postgres role and JWT claims via `set_config()` below the user
 * middleware chain.
 *
 * App code should use the `supabase()` factory; this class is for extension
 * authors who need to subclass further.
 */
export class SupabaseRuntime<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends PostgresRuntime<TContract> {
  executeWithRole<Row>(
    plan: SqlExecutionPlan<Row> | SqlQueryPlan<Row>,
    binding: SupabaseRoleBinding,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    return this.executeWithSessionBootstrap(
      plan,
      (conn: RawSessionConnection) => this.applyRoleBinding(conn, binding),
      options,
    );
  }

  executeRoleTransaction<R>(
    binding: SupabaseRoleBinding,
    fn: (tx: TransactionContext) => PromiseLike<R>,
  ): Promise<R> {
    return this.executeTransactionWithBootstrap(
      (conn: RawSessionConnection) => this.applyRoleBinding(conn, binding),
      fn,
    );
  }

  private async applyRoleBinding(
    conn: RawSessionConnection,
    binding: SupabaseRoleBinding,
  ): Promise<void> {
    await conn.query('SELECT set_config($1, $2, true)', ['role', binding.role]);
    await conn.query('SELECT set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify(binding.claims ?? {}),
    ]);
  }
}
