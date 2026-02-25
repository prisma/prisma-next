import type { ContractBase, ExecutionPlan } from '@prisma-next/contract/types';
import type {
  AsyncIterableResult,
  RuntimeConnection,
  RuntimeTransaction,
} from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  KYSELY_TRANSFORM_ERROR_CODES,
  KyselyTransformError,
  runGuardrails,
  transformKyselyToPnAst,
} from '@prisma-next/sql-kysely-lane';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';
import type { CompiledQuery, DatabaseConnection, QueryResult, TransactionSettings } from 'kysely';

const TRANSFORMABLE_KINDS = new Set([
  'SelectQueryNode',
  'InsertQueryNode',
  'UpdateQueryNode',
  'DeleteQueryNode',
]);
const RAW_QUERY_KIND = 'RawNode';

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
    const query = (compiledQuery as { query?: unknown }).query;
    const sqlContract = this.#contract as SqlContract<SqlStorage>;

    const kind = (query as { kind?: string })?.kind;
    if (query && typeof query === 'object' && kind !== undefined && TRANSFORMABLE_KINDS.has(kind)) {
      runGuardrails(sqlContract, query);
      const { ast, metaAdditions } = (() => {
        try {
          return transformKyselyToPnAst(sqlContract, query, compiledQuery.parameters);
        } catch (error) {
          if (
            KyselyTransformError.is(error) &&
            error.code === KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE
          ) {
            throw planUnsupportedForKysely(kind, error.message);
          }
          throw error;
        }
      })();

      const annotations: { codecs?: Record<string, string>; selectAllIntent?: { table?: string } } =
        {};
      if (metaAdditions.projectionTypes && Object.keys(metaAdditions.projectionTypes).length > 0) {
        annotations.codecs = { ...metaAdditions.projectionTypes };
      }
      if (metaAdditions.selectAllIntent) {
        annotations.selectAllIntent = metaAdditions.selectAllIntent;
      }

      const paramDescriptors = metaAdditions.paramDescriptors;
      const params = compiledQuery.parameters.slice(0, paramDescriptors.length);

      return {
        ast,
        params,
        meta: {
          target: this.#contract.target,
          targetFamily: this.#contract.targetFamily,
          storageHash: this.#contract.storageHash,
          ...ifDefined('profileHash', this.#contract.profileHash),
          lane: 'kysely' as const,
          paramDescriptors,
          refs: metaAdditions.refs,
          ...ifDefined('projection', metaAdditions.projection),
          ...ifDefined(
            'projectionTypes',
            metaAdditions.projectionTypes !== undefined &&
              Object.keys(metaAdditions.projectionTypes).length > 0
              ? metaAdditions.projectionTypes
              : undefined,
          ),
          ...ifDefined(
            'annotations',
            Object.keys(annotations).length > 0 ? annotations : undefined,
          ),
        },
      };
    }
    if (query && typeof query === 'object' && kind !== undefined && kind !== RAW_QUERY_KIND) {
      throw planUnsupportedForKysely(kind);
    }

    return {
      ast: undefined,
      sql: compiledQuery.sql,
      params: compiledQuery.parameters,
      meta: {
        target: this.#contract.target,
        targetFamily: this.#contract.targetFamily,
        storageHash: this.#contract.storageHash,
        ...ifDefined('profileHash', this.#contract.profileHash),
        lane: 'raw',
        paramDescriptors: [],
      },
    };
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
