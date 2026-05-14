import type { Contract } from '@prisma-next/contract/types';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateSqlContract } from '@prisma-next/sql-contract/validators';

/**
 * SQLite target `ContractSerializer` concretion. Mirrors the Postgres
 * shape: structural validation delegates to `validateSqlContract`;
 * `constructTargetContract` returns the validated flat-data shape
 * unchanged. The IR-class hierarchy lift (`SqliteStorage`,
 * `SqliteTable`, …) lands in the next round.
 *
 * `serializeContract` falls through to the family-base default —
 * SQLite's flat-data contract is JSON-clean today. Once the IR-class
 * hierarchy introduces runtime-only fields (e.g. namespaces), this
 * method becomes the home for stripping them from the persisted
 * envelope.
 */
export class SqliteContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  protected parseSqlContractStructure(json: unknown): Contract<SqlStorage> {
    return validateSqlContract<Contract<SqlStorage>>(json);
  }

  protected constructTargetContract(validated: unknown): Contract<SqlStorage> {
    return validated as Contract<SqlStorage>;
  }
}
