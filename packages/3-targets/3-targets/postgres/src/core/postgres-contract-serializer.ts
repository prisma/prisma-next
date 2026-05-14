import type { Contract } from '@prisma-next/contract/types';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

/**
 * Postgres target `ContractSerializer` concretion. Inherits the full
 * SQL-family deserialization pipeline (structural validation +
 * hydration walker that materialises the SQL Contract IR class
 * hierarchy from the validated JSON envelope). Postgres' contract
 * shape is the family-shared shape today; no target-specific
 * construction step is needed and `constructTargetContract` falls
 * through to the family-base identity default.
 *
 * `serializeContract` falls through to the family-base default —
 * Postgres' contract is JSON-clean today, so no on-the-way-out
 * canonicalization is needed. Once target-only fields land (e.g.
 * per-target derived storage fields) this is the home for stripping
 * them from the persisted envelope.
 */
export class PostgresContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {}
