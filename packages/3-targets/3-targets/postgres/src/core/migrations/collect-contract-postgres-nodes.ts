import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { PostgresRlsPolicy } from '../postgres-rls-policy';
import type { PostgresRole } from '../postgres-role';
import { isPostgresSchema } from '../postgres-schema';

/** Collect a contract's Postgres RLS policy nodes. */
export function collectContractRlsPolicies(
  contract: Contract<SqlStorage> | null,
): readonly PostgresRlsPolicy[] {
  if (contract === null) return [];
  return Object.values(contract.storage.namespaces).flatMap((ns) =>
    isPostgresSchema(ns) ? Object.values(ns.policy) : [],
  );
}

/** Collect a contract's Postgres role nodes. */
export function collectContractRoles(
  contract: Contract<SqlStorage> | null,
): readonly PostgresRole[] {
  if (contract === null) return [];
  return Object.values(contract.storage.namespaces).flatMap((ns) =>
    isPostgresSchema(ns) ? Object.values(ns.role) : [],
  );
}
