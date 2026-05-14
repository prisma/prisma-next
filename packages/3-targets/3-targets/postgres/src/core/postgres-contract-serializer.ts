import type { Contract } from '@prisma-next/contract/types';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateSqlContract } from '@prisma-next/sql-contract/validators';

/**
 * Postgres target `ContractSerializer` concretion. Plugs into the
 * SQL-shared deserialization pipeline at `constructTargetContract`.
 *
 * The structural-validation step delegates to the existing
 * `validateSqlContract` arktype-backed validator from `sql-contract`;
 * `constructTargetContract` returns the validated flat-data shape
 * unchanged. The IR-class hierarchy lift (`PostgresStorage`,
 * `PostgresTable`, …) lands in the next round; at that point this
 * subclass walks the validated tree to construct the class instances.
 *
 * `serializeContract` falls through to the family-base default —
 * Postgres' flat-data contract is JSON-clean today, so no on-the-way-out
 * canonicalization is needed. The runtime-only field convention
 * established for Mongo carries over: once the IR-class hierarchy adds
 * runtime-only fields (e.g. `PostgresStorage.namespaces`) this method
 * is the home for stripping them from the persisted envelope.
 */
export class PostgresContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  protected parseSqlContractStructure(json: unknown): Contract<SqlStorage> {
    return validateSqlContract<Contract<SqlStorage>>(json);
  }

  protected constructTargetContract(validated: unknown): Contract<SqlStorage> {
    return validated as Contract<SqlStorage>;
  }
}
