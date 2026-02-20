import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';

export type IncludeStrategy = 'lateral' | 'correlated' | 'multiQuery';

export function selectIncludeStrategy(contract: SqlContract<SqlStorage>): IncludeStrategy {
  const capabilities = contract.capabilities as Record<string, unknown> | undefined;
  const hasLateral = hasCapability(capabilities?.['lateral']);
  const hasJsonAgg = hasCapability(capabilities?.['jsonAgg']);

  if (hasLateral && hasJsonAgg) {
    return 'lateral';
  }

  if (hasJsonAgg) {
    return 'correlated';
  }

  return 'multiQuery';
}

function hasCapability(value: unknown): boolean {
  if (value === true) {
    return true;
  }

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const flags = value as Record<string, unknown>;
  return Object.values(flags).some((flag) => flag === true);
}
