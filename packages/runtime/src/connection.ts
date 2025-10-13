import { Pool, PoolClient } from 'pg';
import { Schema } from '@prisma/relational-ir';
import { Plan } from '@prisma/sql';

export interface ConnectionConfig {
  ir: Schema;
  verify?: 'onFirstUse' | 'never';
  database?: {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
  };
}

export class DatabaseConnection {
  public pool: Pool;
  public ir: Schema;
  public verified: boolean = false;

  constructor(config: ConnectionConfig) {
    this.ir = config.ir;

    const dbConfig = config.database || {};
    this.pool = new Pool({
      host: dbConfig.host || 'localhost',
      port: dbConfig.port || 5432,
      database: dbConfig.database || 'postgres',
      user: dbConfig.user || 'postgres',
      password: dbConfig.password || 'postgres',
    });
  }

  async execute<TResult = any>(plan: Plan<TResult>): Promise<TResult[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(plan.sql, plan.params);
      return result.rows as TResult[];
    } finally {
      client.release();
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }

  public async verifySchema(): Promise<void> {
    const client = await this.pool.connect();

    try {
      // Check if tables exist
      for (const [tableName, table] of Object.entries(this.ir.tables)) {
        const result = await client.query(
          'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)',
          [tableName],
        );

        if (!result.rows[0].exists) {
          throw new Error(`Table '${tableName}' does not exist in database`);
        }

        // Check if columns exist
        for (const [columnName, column] of Object.entries(table.columns)) {
          const columnResult = await client.query(
            'SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = $1 AND column_name = $2)',
            [tableName, columnName],
          );

          if (!columnResult.rows[0].exists) {
            throw new Error(`Column '${columnName}' does not exist in table '${tableName}'`);
          }
        }
      }
    } finally {
      client.release();
    }
  }
}
