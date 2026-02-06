import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import {
  createExecutionStack,
  instantiateExecutionStack,
} from '@prisma-next/core-execution-plane/stack';
import sqliteDriver from '@prisma-next/driver-sqlite/runtime';
import sqlitevectorDescriptor from '@prisma-next/extension-sqlite-vector/runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { createExecutionContext } from '@prisma-next/sql-runtime';
import sqliteTarget from '@prisma-next/target-sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const contract = validateContract<Contract>(contractJson);

export const executionStack = createExecutionStack({
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
  extensionPacks: [sqlitevectorDescriptor],
});

export const executionStackInstance = instantiateExecutionStack(executionStack);
export const executionContext = createExecutionContext({
  contract,
  stackInstance: executionStackInstance,
});
