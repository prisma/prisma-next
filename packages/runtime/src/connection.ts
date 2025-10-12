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

  async execute(
    query: QueryAST | { type: 'raw'; sql: string } | { sql: string; params: unknown[] },
  ): Promise<any[]> {
    if ('type' in query && query.type === 'raw') {
      const client = await this.pool.connect();
      try {
        const result = await client.query(query.sql);
        return result.rows;
      } finally {
        client.release();
      }
    }

    if ('sql' in query && 'params' in query && !('type' in query)) {
      // This is a compiled query object from query.build()
      const client = await this.pool.connect();
      try {
        const result = await client.query(query.sql, query.params);
        return result.rows;
      } finally {
        client.release();
      }
    }

    // This is a QueryAST
    if (!this.verified) {
      await this.verifySchema();
      this.verified = true;
    }

    const { sql, params } = compileToSQL(query as QueryAST);
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
