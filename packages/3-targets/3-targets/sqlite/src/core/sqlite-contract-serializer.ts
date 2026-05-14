import type { Contract } from '@prisma-next/contract/types';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

/**
 * SQLite target `ContractSerializer` concretion. Mirrors the Postgres
 * shape: inherits the full SQL-family deserialization pipeline. Today's
 * SQLite contract shape is the family-shared shape; no target-specific
 * construction step is needed and `constructTargetContract` falls
 * through to the family-base identity default.
 *
 * `serializeContract` falls through to the family-base default —
 * SQLite's contract is JSON-clean today. Once target-only fields land
 * (e.g. per-target namespaces) this is the home for stripping them
 * from the persisted envelope.
 */
export class SqliteContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {}
