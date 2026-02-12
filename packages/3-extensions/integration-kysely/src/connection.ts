import type { ContractBase, ExecutionPlan } from '@prisma-next/contract/types';
import type { RuntimeConnection, RuntimeTransaction } from '@prisma-next/runtime-executor';
import type { CompiledQuery, DatabaseConnection, QueryResult, TransactionSettings } from 'kysely';

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
    return {
      rows: await this.#connection.execute(this.#createExecutionPlan<R>(compiledQuery)).toArray(),
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
    const results = this.#connection.execute(this.#createExecutionPlan<R>(compiledQuery));

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
    return {
      // TODO: convert the Kysely AST into Prisma AST
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
        // TODO: fill in the parameter descriptors
        paramDescriptors: [],
      },
    };
  }
}
