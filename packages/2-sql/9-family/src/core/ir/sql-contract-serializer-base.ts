import type { ContractSerializer } from '@prisma-next/framework-components/control';
import type { JsonObject } from '@prisma-next/utils/json';

/**
 * SQL family `ContractSerializer` abstract base. Carries SQL-shared
 * deserialization scaffolding (structural arktype validation against the
 * SQL-shaped contract envelope, family-level domain checks) and exposes a
 * protected hook for target-specific class construction.
 *
 * Default `serializeContract` is identity over the contract — concrete
 * SQL targets ship JSON-clean class instances, so the contract value can
 * be stringified directly. Targets that need to canonicalize on the way
 * out (key ordering, dropping computed-only fields) override
 * `serializeContract` directly.
 *
 * M1 ships only the abstract shell. Concrete SQL-shared validation logic
 * lands as the `parseSqlContractStructure` body in the M3 commit that
 * wires Postgres + SQLite to the new SPI; the protected hook is declared
 * here so target subclasses (`PostgresContractSerializer`,
 * `SqliteContractSerializer`) compile against a stable base API.
 */
export abstract class SqlContractSerializerBase<TContract>
  implements ContractSerializer<TContract>
{
  deserializeContract(json: unknown): TContract {
    const validated = this.parseSqlContractStructure(json);
    return this.constructTargetContract(validated);
  }

  serializeContract(contract: TContract): JsonObject {
    // SQL contract class fields are JSON-clean by construction; the cast
    // asserts that. Targets that need to canonicalize on the way out
    // override this method.
    return contract as unknown as JsonObject;
  }

  /**
   * Family-shared structural validation (arktype). Subclasses can
   * override to carry target-specific structural checks but most should
   * rely on the family default (M3 commit will provide).
   */
  protected abstract parseSqlContractStructure(json: unknown): unknown;

  /**
   * Target-specific class construction from validated structural data.
   * The target subclass walks the validated value and builds its own
   * `PostgresStorage` / `SqliteStorage` class instances.
   */
  protected abstract constructTargetContract(validated: unknown): TContract;
}
