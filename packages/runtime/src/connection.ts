import { Pool, PoolClient } from 'pg';
import { Schema } from '@prisma/relational-ir';
import { QueryAST, compileToSQL } from '@prisma/sql';

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
  private pool: Pool;
  private ir: Schema;
  private verified: boolean = false;

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

  async execute(query: QueryAST | { type: 'raw'; sql: string }): Promise<any[]> {
    if (query.type === 'raw') {
      const client = await this.pool.connect();
      try {
        const result = await client.query(query.sql);
        return result.rows;
      } finally {
        client.release();
      }
    }

    if (!this.verified) {
      await this.verifySchema();
      this.verified = true;
    }

    const { sql, params } = compileToSQL(query);
    const client = await this.pool.connect();

    try {
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }

  private async verifySchema(): Promise<void> {
    const client = await this.pool.connect();

    try {
      // Check if tables exist
      for (const model of this.ir.models) {
        const tableName = model.name.toLowerCase();
        const result = await client.query(
          'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)',
          [tableName],
        );

        if (!result.rows[0].exists) {
          throw new Error(`Table '${tableName}' does not exist in database`);
        }

        // Check if columns exist
        for (const field of model.fields) {
          const columnResult = await client.query(
            'SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = $1 AND column_name = $2)',
            [tableName, field.name],
          );

          if (!columnResult.rows[0].exists) {
            throw new Error(`Column '${field.name}' does not exist in table '${tableName}'`);
          }
        }
      }
    } finally {
      client.release();
    }
  }
}
