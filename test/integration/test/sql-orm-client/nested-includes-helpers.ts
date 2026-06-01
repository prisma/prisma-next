// Shared utilities for the `nested-includes-*` integration suites.
//
// Each `*.test.ts` file in this set is intentionally small (≤ ~13 tests,
// matching the project convention visible across other files in
// `test/integration/`). Each integration test spins up its own
// prisma/dev PGlite instance via `withCollectionRuntime` (see
// `./helpers`), and at higher per-file test counts the test
// infrastructure exhibits worker-pool contention that surfaces as
// spurious `portal "C_N" does not exist` errors. Splitting the corpus
// across multiple files keeps each invocation under that threshold
// while preserving the breadth of the coverage.

import type { ContractModelsMap } from '@prisma-next/contract/types';
import { Collection } from '@prisma-next/sql-orm-client';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { getTestContext, getTestContract, type TestContract } from './helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

/**
 * Build a `Collection` whose contract carries the given capability
 * overrides. The runtime itself still uses the default postgres test
 * contract; only `dispatchWithIncludeStrategy` reads from the override,
 * so this is the right knob for exercising both single-query dispatch
 * strategies (lateral / correlated) against the same real database.
 */
export function collectionWithCapabilities<
  ModelName extends keyof ContractModelsMap<TestContract> & string,
>(
  runtime: PgIntegrationRuntime,
  modelName: ModelName,
  capabilities: Record<string, Record<string, boolean>>,
): Collection<TestContract, ModelName & string> {
  const base = getTestContract();
  const contract = { ...base, capabilities } as TestContract;
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, modelName as ModelName & string);
}

// Capability constants used across the strategy-variant suites.
// Strategy selection reads from `contract.capabilities[targetFamily]`
// ('sql') and `contract.capabilities[target]` ('postgres'). The shapes
// below match what `selectIncludeStrategy` looks up — no more, no less,
// so test intent is unambiguous and a missing capability cannot leak
// through.
export const LATERAL_CAPABILITIES = {
  postgres: { lateral: true, jsonAgg: true },
} as const;
export const CORRELATED_CAPABILITIES = {
  sql: { jsonAgg: true },
} as const;
