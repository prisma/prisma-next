import { RuntimePlugin, BeforeExecuteContext } from '../../plugin';
import { Schema } from '@prisma/relational-ir';
import { Plan } from '@prisma/sql';

export interface VerificationPluginOptions {
  /** Verification mode: 'onFirstUse' verifies schema and queries, 'never' skips verification */
  mode: 'onFirstUse' | 'never';
}

export interface VerificationPluginState {
  schemaVerified: boolean;
}

/**
 * Verification plugin that handles schema and query verification
 * Replaces the verifyMode functionality from DatabaseConnection
 */
export function verification(options: VerificationPluginOptions): RuntimePlugin {
  const state: VerificationPluginState = {
    schemaVerified: false,
  };

  return {
    async beforeExecute(ctx: BeforeExecuteContext): Promise<void> {
      if (options.mode === 'never') {
        return;
      }

      // Verify schema on first use
      if (!state.schemaVerified) {
        await verifySchema(ctx.ir, ctx.driver);
        state.schemaVerified = true;
      }

      // Verify query references are valid
      await verifyQuery(ctx.plan, ctx.ir);
    },
  };
}

/**
 * Verifies that all tables and columns in the schema exist in the database
 */
async function verifySchema(ir: Schema, driver: any): Promise<void> {
  const client = await driver.pool.connect();

  try {
    // Check if tables exist
    for (const [tableName, table] of Object.entries(ir.tables)) {
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

/**
 * Verifies that all referenced tables and columns in the query exist in the schema
 */
async function verifyQuery(plan: Plan, ir: Schema): Promise<void> {
  // Check that all referenced tables exist in the schema
  if (plan.meta?.refs?.tables) {
    for (const tableName of plan.meta.refs.tables) {
      if (!ir.tables[tableName]) {
        throw new Error(`Table '${tableName}' does not exist in schema`);
      }
    }
  }

  // Check that all referenced columns exist in their respective tables
  if (plan.meta?.refs?.columns) {
    for (const columnRef of plan.meta.refs.columns) {
      const [tableName, columnName] = columnRef.split('.');
      const table = ir.tables[tableName];

      if (!table) {
        throw new Error(`Table '${tableName}' does not exist in schema`);
      }

      if (!table.columns[columnName]) {
        throw new Error(`Column '${columnName}' does not exist in table '${tableName}'`);
      }
    }
  }
}
