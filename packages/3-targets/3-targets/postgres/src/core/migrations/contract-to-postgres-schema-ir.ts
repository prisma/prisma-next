import type { Contract } from '@prisma-next/contract/types';
import type { ContractToSchemaIROptions } from '@prisma-next/family-sql/control';
import { contractToSchemaIR } from '@prisma-next/family-sql/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { PostgresRlsPolicy } from '../postgres-rls-policy';
import type { PostgresRole } from '../postgres-role';
import { isPostgresSchema, type PostgresContract } from '../postgres-schema';
import { PostgresSchemaIR } from '../postgres-schema-ir';

/** Project a contract's Postgres RLS policy nodes. The contract carries them as PostgresRlsPolicy instances. */
export function collectContractRlsPolicies(
  contract: Contract<SqlStorage> | null,
): readonly PostgresRlsPolicy[] {
  if (contract === null) return [];
  return Object.values(contract.storage.namespaces).flatMap((ns) =>
    isPostgresSchema(ns) ? Object.values(ns.policy) : [],
  );
}

function collectContractRoles(contract: Contract<SqlStorage> | null): readonly PostgresRole[] {
  if (contract === null) return [];
  return Object.values(contract.storage.namespaces).flatMap((ns) =>
    isPostgresSchema(ns) ? Object.values(ns.role) : [],
  );
}

/** The contract-to-postgres-schema-ir derivation: a populated PostgresSchemaIR. */
export function contractToPostgresSchemaIR(
  contract: PostgresContract | null,
  options: ContractToSchemaIROptions,
): PostgresSchemaIR {
  const sqlIr = contractToSchemaIR(contract, options);
  return new PostgresSchemaIR({
    tables: sqlIr.tables,
    rlsPolicies: collectContractRlsPolicies(contract),
    roles: collectContractRoles(contract),
    pgSchemaName: 'public',
    pgVersion: '',
    existingSchemas: [],
    nativeEnumTypeNames: [],
  });
}
