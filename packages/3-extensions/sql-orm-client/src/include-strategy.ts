import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

export type IncludeStrategy = 'lateral' | 'correlated' | 'multiQuery';

/**
 * Choose the SQL emission strategy for nested includes based on the
 * contract's declared capabilities.
 *
 * - `'lateral'`: outer SELECT with one LATERAL JOIN per relation,
 *   aggregating to JSON. Requires both `lateral` and `jsonAgg`.
 *   Postgres has both.
 * - `'correlated'`: outer SELECT with one correlated subquery per
 *   relation, aggregating to JSON. Requires `jsonAgg` only.
 *   SQLite has `jsonAgg` (via `json_group_array`) but no LATERAL.
 * - `'multiQuery'`: fallback. One SELECT per relation, stitched
 *   together in JS via `WHERE pk IN (parent-pk-values)`. Always
 *   correct; just N+1 round-trips.
 *
 * The capability flags are looked up under the contract's
 * `targetFamily` and `target` namespaces — the two layers the contract
 * emitter actually populates. Cross-namespace ("`postgres.lateral`
 * found while running SQLite") false positives are impossible because
 * we only inspect the running target's namespaces.
 */
export function selectIncludeStrategy(contract: Contract<SqlStorage>): IncludeStrategy {
  const hasLateral = capabilityFlag(contract, 'lateral');
  const hasJsonAgg = capabilityFlag(contract, 'jsonAgg');

  if (hasLateral && hasJsonAgg) {
    return 'lateral';
  }

  if (hasJsonAgg) {
    return 'correlated';
  }

  return 'multiQuery';
}

/**
 * Read a capability flag from the contract's target/family namespaces.
 *
 * The contract emitter populates `capabilities[targetFamily]` (universal
 * SQL flags like `jsonAgg`, `returning`) and `capabilities[target]`
 * (target-specific flags like `lateral` on Postgres). Either may
 * declare a given flag; the family namespace declares the floor and the
 * target namespace can extend on top.
 */
function capabilityFlag(contract: Contract<SqlStorage>, flag: string): boolean {
  return (
    contract.capabilities[contract.targetFamily]?.[flag] === true ||
    contract.capabilities[contract.target]?.[flag] === true
  );
}
