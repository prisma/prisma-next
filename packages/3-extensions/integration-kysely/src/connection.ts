import type { ContractBase } from '@prisma-next/contract/types';
import type { RuntimeConnection, RuntimeTransaction } from '@prisma-next/runtime-executor';
import type { CompiledQuery, DatabaseConnection, QueryResult, TransactionSettings } from 'kysely';
import { createExecutionPlanFromCompiledQuery } from './execution-plan';

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
    const plan = createExecutionPlanFromCompiledQuery<R>(
      this.#contract,
      compiledQuery as CompiledQuery<R>,
      { lane: 'raw' },
    );
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
    const plan = createExecutionPlanFromCompiledQuery<R>(
      this.#contract,
      compiledQuery as CompiledQuery<R>,
      { lane: 'raw' },
    );
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
}
