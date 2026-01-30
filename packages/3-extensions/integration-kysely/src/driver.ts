import type { DatabaseConnection, Driver, TransactionSettings } from 'kysely';
import type { KyselyPrismaDialectConfig } from './config.js';
import { KyselyPrismaConnection } from './connection.js';

export class KyselyPrismaDriver implements Driver {
  readonly #config: KyselyPrismaDialectConfig;

  constructor(config: KyselyPrismaDialectConfig) {
    this.#config = config;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const connection = await this.#config.runtime.connection();
    return new KyselyPrismaConnection(this.#config.contract, connection);
  }

  async beginTransaction(
    connection: KyselyPrismaConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    await connection.beginTransaction(settings);
  }

  async commitTransaction(connection: KyselyPrismaConnection): Promise<void> {
    await connection.commitTransaction();
  }

  async destroy(): Promise<void> {
    // noop
  }

  async init(): Promise<void> {
    // noop
  }

  async releaseConnection(connection: KyselyPrismaConnection): Promise<void> {
    await connection.release();
  }

  async rollbackTransaction(connection: KyselyPrismaConnection): Promise<void> {
    await connection.rollbackTransaction();
  }
}
