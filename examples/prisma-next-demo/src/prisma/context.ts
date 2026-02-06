/**
 * Static Prisma Next Context (Emitted Contract Workflow)
 *
 * This module sets up everything needed for query building without any
 * runtime instantiation side-effects. Importing this module does NOT:
 * - instantiate adapter/extension instances
 * - create database connections
 * - construct a driver
 *
 * Exports:
 * - Query roots: `schema`, `tables`, `sql`, `orm`
 * - Runtime wiring inputs: `executionStack`, `executionContext`
 */
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { createExecutionStack } from '@prisma-next/core-execution-plane/stack';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvectorDescriptor from '@prisma-next/extension-pgvector/runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { createExecutionContext } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// 1. Validate / load the emitted contract
// ---------------------------------------------------------------------------
const contract = validateContract<Contract>(contractJson);

// ---------------------------------------------------------------------------
// 2. Define descriptors-only execution stack (no instantiation)
// ---------------------------------------------------------------------------
export const executionStack = createExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [pgvectorDescriptor],
});

// ---------------------------------------------------------------------------
// 3. Build static execution context from contract + descriptor stack
// ---------------------------------------------------------------------------
export const executionContext = createExecutionContext({
  contract,
  stack: executionStack,
});

// ---------------------------------------------------------------------------
// 4. Query roots — usable without any runtime / database connection
// ---------------------------------------------------------------------------
export const schema = schemaBuilder(executionContext);
export const tables = schema.tables;
export const sql = sqlBuilder({ context: executionContext });
export const orm = ormBuilder({ context: executionContext });
