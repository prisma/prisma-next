import type { ContractBase, ExecutionPlan } from '@prisma-next/contract/types';
import type {
  AsyncIterableResult,
  RuntimeConnection,
  RuntimeTransaction,
} from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  buildKyselyPlan,
  KYSELY_TRANSFORM_ERROR_CODES,
  KyselyTransformError,
} from '@prisma-next/sql-kysely-lane';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';
import type { CompiledQuery, DatabaseConnection, QueryResult, TransactionSettings } from 'kysely';

function planUnsupportedForKysely(
  kind: string,
  reason?: string,
): Error & {
  readonly code: 'PLAN.UNSUPPORTED';
  readonly category: 'PLAN';
  readonly severity: 'error';
  readonly details: { lane: 'kysely'; kyselyKind: string; reason?: string };
} {
  const message = reason
    ? `Unsupported Kysely query kind: ${kind}. ${reason}`
    : `Unsupported Kysely query kind: ${kind}`;
  const error = new Error(message) as Error & {
    code: 'PLAN.UNSUPPORTED';
    category: 'PLAN';
    severity: 'error';
    details: { lane: 'kysely'; kyselyKind: string; reason?: string };
  };
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return Object.assign(error, {
    code: 'PLAN.UNSUPPORTED' as const,
    category: 'PLAN' as const,
    severity: 'error' as const,
    details: {
      lane: 'kysely' as const,
      kyselyKind: kind,
      ...ifDefined('reason', reason),
    },
  });
}

export class KyselyPrismaConnection implements DatabaseConnection {
  #contract: ContractBase;
  #connection: RuntimeConnection | undefined;
  #transaction: RuntimeTransaction | undefined;

  constructor(contract: ContractBase, connection: RuntimeConnection) {
    this.#contract = contract;
    this.#connection = connection;
  }

  async beginTransaction(_settings: TransactionSettings): Promise<void> {
    if (!this.#connection) {
      throw new Error('Invoked beginTransaction on released connection');
    }
    // TODO: use the TransactionSettings
    this.#transaction = await this.#connection.transaction();
  }

  async commitTransaction(): Promise<void> {
    if (!this.#transaction) {
      throw new Error('Invoked commitTransaction without an active transaction');
    }
    await this.#transaction.commit();
    this.#transaction = undefined;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery<unknown>): Promise<QueryResult<R>> {
    if (!this.#connection) {
      throw new Error('Invoked executeQuery on released connection');
    }
    const plan = this.#createExecutionPlan<R>(compiledQuery);
    return { rows: await this.#executor().execute(plan).toArray() };
  }

  async release(): Promise<void> {
    await this.#connection?.release();
    this.#connection = undefined;
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.#transaction) {
      throw new Error('Invoked rollbackTransaction without an active transaction');
    }
    await this.#transaction.rollback();
    this.#transaction = undefined;
  }

  streamQuery<R>(
    compiledQuery: CompiledQuery<unknown>,
    chunkSize?: number | undefined,
  ): AsyncIterableIterator<QueryResult<R>> {
    if (!this.#connection) {
      throw new Error('Invoked streamQuery on released connection');
    }
    const plan = this.#createExecutionPlan<R>(compiledQuery);
    const results = this.#executor().execute(plan);

    const generator = async function* (): AsyncIterableIterator<QueryResult<R>> {
      let chunk: R[] = [];
      for await (const row of results) {
        chunk.push(row);
        if (chunkSize !== undefined && chunk.length >= chunkSize) {
          yield { rows: chunk };
          chunk = [];
        }
      }
      if (chunk.length > 0) {
        yield { rows: chunk };
      }
    };

    return generator();
  }

  #createExecutionPlan<R>(compiledQuery: CompiledQuery<R>): SqlQueryPlan<R> | ExecutionPlan<R> {
    const sqlContract = this.#contract as SqlContract<SqlStorage>;
    const kind = (compiledQuery as { query?: { kind?: string } }).query?.kind ?? 'unknown';
    try {
      return buildKyselyPlan(sqlContract, compiledQuery, { lane: 'kysely' });
    } catch (error) {
      if (
        KyselyTransformError.is(error) &&
        error.code === KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE
      ) {
        throw planUnsupportedForKysely(kind, error.message);
      }
      throw error;
    }
  }

  #executor(): {
    execute<P>(plan: ExecutionPlan<P> | SqlQueryPlan<P>): AsyncIterableResult<P>;
  } {
    if (this.#transaction) {
      return this.#transaction as {
        execute<P>(plan: ExecutionPlan<P> | SqlQueryPlan<P>): AsyncIterableResult<P>;
      };
    }
    if (!this.#connection) {
      throw new Error('Invoked executeQuery on released connection');
    }
    return this.#connection as {
      execute<P>(plan: ExecutionPlan<P> | SqlQueryPlan<P>): AsyncIterableResult<P>;
    };
  }
}
