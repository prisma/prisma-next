import type { ContractToSchemaIROptions } from '@prisma-next/family-sql/control';
import { contractToSchemaIR } from '@prisma-next/family-sql/control';
import type { PostgresContract } from '../postgres-schema';
import { PostgresSchemaIR } from '../postgres-schema-ir';
import {
  collectContractRlsPolicies,
  collectContractRoles,
} from './collect-contract-postgres-nodes';

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
