import type { ContractSerializer } from '@prisma-next/framework-components/control';
import type { JsonObject } from '@prisma-next/utils/json';

/**
 * Mongo family `ContractSerializer` abstract base. Carries Mongo-shared
 * deserialization scaffolding (structural arktype validation against the
 * Mongo-shaped contract envelope, family-level domain checks) and exposes
 * a protected hook for target-specific class construction.
 *
 * Default `serializeContract` is identity over the contract — Mongo
 * target ships JSON-clean class instances, so the contract value can be
 * stringified directly. Targets that need to canonicalize on the way out
 * override `serializeContract`.
 *
 * M1 ships only the abstract shell. Mongo-shared validation logic lands
 * as the `parseMongoContractStructure` body in M2 alongside the Mongo
 * target's concrete IR class flip; the protected hook is declared here
 * so `MongoTargetContractSerializer` compiles against a stable base API.
 */
export abstract class MongoContractSerializerBase<TContract>
  implements ContractSerializer<TContract>
{
  deserializeContract(json: unknown): TContract {
    const validated = this.parseMongoContractStructure(json);
    return this.constructTargetContract(validated);
  }

  serializeContract(contract: TContract): JsonObject {
    // Mongo contract class fields are JSON-clean by construction; the
    // cast asserts that. Targets that need to canonicalize on the way
    // out override this method.
    return contract as unknown as JsonObject;
  }

  /**
   * Family-shared structural validation (arktype). Subclasses can
   * override to carry target-specific structural checks but most should
   * rely on the family default (M2 commit will provide).
   */
  protected abstract parseMongoContractStructure(json: unknown): unknown;

  /**
   * Target-specific class construction from validated structural data.
   * The target subclass walks the validated value and builds its own
   * `MongoTargetStorage` class instances.
   */
  protected abstract constructTargetContract(validated: unknown): TContract;
}
