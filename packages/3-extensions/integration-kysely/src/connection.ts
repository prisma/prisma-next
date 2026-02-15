import type { ContractBase, ExecutionPlan } from '@prisma-next/contract/types';
import type { RuntimeConnection, RuntimeTransaction } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CompiledQuery, DatabaseConnection, QueryResult, TransactionSettings } from 'kysely';
import { runGuardrails, transformKyselyToPnAst } from './transform/index.js';

const TRANSFORMABLE_KINDS = new Set([
  'SelectQueryNode',
  'InsertQueryNode',
  'UpdateQueryNode',
  'DeleteQueryNode',
]);

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
    const plan = this.#createExecutionPlan(compiledQuery as CompiledQuery<R>);
    return {
      rows: await this.#connection.execute(plan).toArray(),
    };
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
    const plan = this.#createExecutionPlan(compiledQuery as CompiledQuery<R>);
    const results = this.#connection.execute(plan);

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

  #createExecutionPlan<R>(compiledQuery: CompiledQuery<R>): ExecutionPlan<R, unknown> {
    const query = (compiledQuery as { query?: unknown }).query;
    const sqlContract = this.#contract as SqlContract<SqlStorage>;

    const kind = (query as { kind?: string })?.kind;
    if (query && typeof query === 'object' && kind !== undefined && TRANSFORMABLE_KINDS.has(kind)) {
      runGuardrails(sqlContract, query);
      const { ast, metaAdditions } = transformKyselyToPnAst(
        sqlContract,
        query,
        compiledQuery.parameters,
      );

      const baseMeta = {
        target: this.#contract.target,
        targetFamily: this.#contract.targetFamily,
        storageHash: this.#contract.storageHash,
        ...(this.#contract.profileHash !== undefined
          ? { profileHash: this.#contract.profileHash }
          : {}),
        lane: 'kysely' as const,
        paramDescriptors: metaAdditions.paramDescriptors,
        refs: metaAdditions.refs,
        ...(metaAdditions.projection !== undefined && { projection: metaAdditions.projection }),
        ...(metaAdditions.projectionTypes !== undefined &&
          Object.keys(metaAdditions.projectionTypes).length > 0 && {
            projectionTypes: metaAdditions.projectionTypes,
          }),
      };

      const annotations: { codecs?: Record<string, string>; selectAllIntent?: { table?: string } } =
        {};
      if (metaAdditions.projectionTypes && Object.keys(metaAdditions.projectionTypes).length > 0) {
        annotations.codecs = { ...metaAdditions.projectionTypes };
      }
      if (metaAdditions.selectAllIntent) {
        annotations.selectAllIntent = metaAdditions.selectAllIntent;
      }

      return {
        ast,
        sql: compiledQuery.sql,
        params: compiledQuery.parameters,
        meta: {
          ...baseMeta,
          ...(Object.keys(annotations).length > 0 && { annotations }),
        },
      };
    }

    return {
      ast: undefined,
      sql: compiledQuery.sql,
      params: compiledQuery.parameters,
      meta: {
        target: this.#contract.target,
        targetFamily: this.#contract.targetFamily,
        storageHash: this.#contract.storageHash,
        ...(this.#contract.profileHash !== undefined
          ? { profileHash: this.#contract.profileHash }
          : {}),
        lane: 'raw',
        paramDescriptors: [],
      },
    };
  }
}
