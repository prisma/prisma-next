import { Pool, PoolClient } from 'pg';
import { ScriptAST } from './script-ast';
import { renderScript } from './lowering/renderer';

export interface AdminConnection {
  target: 'postgres';
  withAdvisoryLock<T>(key: string, f: () => Promise<T>): Promise<T>;
  executeScript(
    script: ScriptAST,
  ): Promise<{ sql: string; params: unknown[]; sqlHash: `sha256:${string}` }>;
  readContract(): Promise<{ hash: `sha256:${string}` | null }>;
  writeContract(hash: `sha256:${string}`): Promise<void>;
  close(): Promise<void>;
}

export async function connectAdmin(url: string): Promise<AdminConnection> {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  // Set session guards
  await client.query("SET lock_timeout = '5s'");
  await client.query("SET statement_timeout = '5min'");
  await client.query("SET idle_in_transaction_session_timeout = '60s'");
  await client.query("SET client_min_messages = 'warning'");

  let hasContractTable = false;

  return {
    target: 'postgres',

    async withAdvisoryLock<T>(key: string, f: () => Promise<T>): Promise<T> {
      try {
        // Generate stable advisory lock key
        const lockKeyResult = await client.query(
          `
          SELECT hashtext(current_database() || '') # hashtext($1) as lock_key
        `,
          ['prisma:migrate'],
        );

        const lockKey = lockKeyResult.rows[0].lock_key;

        // Acquire advisory lock
        await client.query('SELECT pg_advisory_lock($1)', [lockKey]);

        try {
          return await f();
        } finally {
          // Release advisory lock
          await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
        }
      } catch (error) {
        throw new Error(`Advisory lock operation failed: ${error}`);
      }
    },

    async executeScript(
      script: ScriptAST,
    ): Promise<{ sql: string; params: unknown[]; sqlHash: `sha256:${string}` }> {
      const { sql, params, sqlHash } = renderScript(script);

      try {
        await client.query(sql);
        return { sql, params, sqlHash: sqlHash as `sha256:${string}` };
      } catch (error) {
        throw new Error(`Script execution failed: ${error}\nSQL: ${sql}`);
      }
    },

    async readContract(): Promise<{ hash: `sha256:${string}` | null }> {
      try {
        const result = await client.query(`
          SELECT hash FROM prisma_contract.version
          WHERE id = 1
        `);

        if (result.rows.length === 0) {
          hasContractTable = false;
          return { hash: null };
        }

        hasContractTable = true;
        return { hash: result.rows[0].hash as `sha256:${string}` };
      } catch (error) {
        // Table doesn't exist yet
        hasContractTable = false;
        return { hash: null };
      }
    },

    async writeContract(hash: `sha256:${string}`): Promise<void> {
      // Create contract schema and table if they don't exist
      if (!hasContractTable) {
        await client.query(`
          CREATE SCHEMA IF NOT EXISTS prisma_contract;
          CREATE TABLE IF NOT EXISTS prisma_contract.version (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        hasContractTable = true;
      }

      // Upsert contract hash (insert or update row with id=1)
      await client.query(
        `
        INSERT INTO prisma_contract.version (id, hash)
        VALUES (1, $1)
        ON CONFLICT (id) DO UPDATE SET
          hash = EXCLUDED.hash,
          updated_at = now()
      `,
        [hash],
      );
    },

    async close(): Promise<void> {
      client.release();
      await pool.end();
    },
  };
}
