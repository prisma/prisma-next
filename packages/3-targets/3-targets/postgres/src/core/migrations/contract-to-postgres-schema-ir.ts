import type { ContractToSchemaIROptions } from '@prisma-next/family-sql/control';
import { contractToSchemaIR } from '@prisma-next/family-sql/control';
import type { PostgresContract } from '../postgres-schema';
import { isPostgresSchema } from '../postgres-schema';
import { PostgresSchemaIR } from '../postgres-schema-ir';
import { resolveDdlSchemaForNamespaceStorage } from '../postgres-schema-ir-annotations';
import {
  collectContractRlsTableNodes,
  collectContractRoles,
} from './collect-contract-postgres-nodes';

/** The contract-to-postgres-schema-ir derivation: a populated PostgresSchemaIR. */
export function contractToPostgresSchemaIR(
  contract: PostgresContract | null,
  options: ContractToSchemaIROptions,
): PostgresSchemaIR {
  const sqlIr = contractToSchemaIR(contract, options);
  const ownedSchemas =
    contract === null
      ? []
      : Object.values(contract.storage.namespaces)
          .filter((ns) => isPostgresSchema(ns))
          .map((ns) => resolveDdlSchemaForNamespaceStorage(contract.storage, ns.id));
  return new PostgresSchemaIR({
    tables: sqlIr.tables,
    tableNodes: collectContractRlsTableNodes(contract),
    roles: collectContractRoles(contract),
    pgSchemaName: 'public',
    pgVersion: '',
    existingSchemas: ownedSchemas,
    nativeEnumTypeNames: [],
  });
}
