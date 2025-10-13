import { Pool, PoolClient } from 'pg';
import { Schema } from '@prisma/relational-ir';
import { Plan } from '@prisma/sql';

export interface ConnectionConfig {
  ir: Schema;
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
}
