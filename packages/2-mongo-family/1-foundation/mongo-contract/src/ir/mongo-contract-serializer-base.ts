import { validateContractDomain } from '@prisma-next/contract/validate-domain';
import type { ContractSerializer } from '@prisma-next/framework-components/control';
import type { JsonObject } from '@prisma-next/utils/json';
import { type as arktypeType } from 'arktype';
import { MongoContractSchema } from '../contract-schema';
import type { MongoContract } from '../contract-types';
import { validateMongoStorage } from '../validate-storage';

/**
 * Mongo family `ContractSerializer` abstract base. Owns the family-shared
 * deserialization pipeline:
 *
 * 1. Structural validation against the Mongo contract arktype schema
 *    (`MongoContractSchema`).
 * 2. Framework-shared domain validation (`validateContractDomain`).
 * 3. Family-shared storage validation (`validateMongoStorage`).
 *
 * The validated value is handed to the target via the
 * `constructTargetContract` hook, which wraps the plain-JSON shape in
 * the target's class hierarchy (e.g. `MongoTargetStorage` with
 * `namespaces`). Targets that need to add structural checks beyond the
 * family default can override `parseMongoContractStructure`.
 *
 * Default `serializeContract` is identity over the contract — Mongo
 * target classes carry JSON-clean fields by construction, so the value
 * can be `JSON.stringify`'d directly. Targets that need on-the-way-out
 * canonicalization override `serializeContract`.
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
   * Family-shared structural validation: parse against the Mongo
   * contract arktype schema, then run framework-shared domain + Mongo
   * family storage checks. Targets can override to add target-specific
   * structural checks; most targets accept the family default.
   *
   * Returns the validated value (still in flat-data JSON shape); the
   * IR-class-flip for Contract IR leaf nodes (`MongoIndex`,
   * `MongoIndexOptions`, …) lands in a later commit and reshapes this
   * return value to instantiated AST classes.
   */
  protected parseMongoContractStructure(json: unknown): MongoContract {
    const parsed = MongoContractSchema(json);
    if (parsed instanceof arktypeType.errors) {
      throw new Error(`Contract structural validation failed: ${parsed.summary}`);
    }

    const contract = parsed as unknown as MongoContract;

    validateContractDomain(contract);
    validateMongoStorage(contract);

    return contract;
  }

  /**
   * Target-specific class construction from the validated structural
   * data. The target wraps the contract envelope in its own
   * `MongoTargetStorage` class instance (`namespaces` field, target
   * concretions, …); the leaf collection / index shapes remain plain
   * data until the IR-node class flip lands.
   */
  protected abstract constructTargetContract(validated: MongoContract): TContract;
}
