import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { SqlContractSerializerBase } from './sql-contract-serializer-base';

/**
 * Default SQL family `ContractSerializer` concretion. Inherits the
 * full SQL-shared deserialization pipeline (structural validation +
 * IR-class hydration) without target-specific construction. Targets
 * that share the family's contract shape today (Postgres, SQLite)
 * mirror this class with a per-target subclass so the descriptor
 * surfaces a target-specific identity for narrowing; family-level
 * call sites (family-instance methods, family-layer tests that
 * exercise SQL-shared validation) instantiate this default directly.
 */
export class SqlContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {}
