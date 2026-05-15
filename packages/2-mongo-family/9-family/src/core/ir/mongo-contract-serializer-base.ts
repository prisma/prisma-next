import { validateContractDomain } from '@prisma-next/contract/validate-domain';
import type { ContractSerializer } from '@prisma-next/framework-components/control';
import {
  MongoCollection,
  type MongoCollectionInput,
  type MongoContract,
  MongoContractSchema,
  validateMongoStorage,
} from '@prisma-next/mongo-contract';
import type { JsonObject } from '@prisma-next/utils/json';
import { type as arktypeType } from 'arktype';

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
 * the family-layer `MongoStorage` class instance (carrying the
 * target-supplied `namespaces` map). Targets that need to add
 * structural checks beyond the family default can override
 * `parseMongoContractStructure`.
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
   * family storage checks, then hydrate the validated tree into Mongo
   * Contract IR class instances. Targets can override to add
   * target-specific structural checks; most targets accept the family
   * default.
   *
   * The returned `MongoContract` carries class instances under
   * `storage.collections` (each value is a `MongoCollection`, with
   * nested `MongoIndex` / `MongoValidator` / `MongoCollectionOptions`
   * constructed by the `MongoCollection` constructor). The rest of the
   * contract envelope (models, valueObjects, capabilities, …) remains
   * in plain-JSON form; those IR layers are handled by sibling
   * subsystems and don't sit behind this SPI.
   */
  protected parseMongoContractStructure(json: unknown): MongoContract {
    const parsed = MongoContractSchema(json);
    if (parsed instanceof arktypeType.errors) {
      throw new Error(`Contract structural validation failed: ${parsed.summary}`);
    }

    // arktype's `infer`d type for `MongoContractSchema` is structurally
    // equivalent to `MongoContract` (both describe the same on-disk JSON
    // envelope) but not nominally so: the arktype DSL produces a type whose
    // optional/readonly profile, narrowed string-literal positions, and
    // utility-type wrappings (`Type.infer`, `Out`, …) differ from the
    // hand-authored `MongoContract<S, M>` generic surface. The schema and
    // the type are kept in lockstep by the round-trip fixtures under
    // `test/validate.test.ts`. The hydration walk below additionally
    // re-shapes `storage.collections` from plain data into IR-class
    // instances, so the `MongoContract` returned here carries class
    // identity under `storage.collections.*` (and transitively under
    // `indexes` / `validator` / `options`).
    const validatedShape = parsed as unknown as MongoContract;

    const hydratedContract = this.hydrateMongoContract(validatedShape);

    validateContractDomain(hydratedContract);
    validateMongoStorage(hydratedContract);

    return hydratedContract;
  }

  /**
   * Walk a structurally-validated Mongo contract and convert
   * `storage.collections` entries from plain data into
   * `MongoCollection` IR-class instances. Idempotent: already-class
   * instances pass through unchanged.
   */
  protected hydrateMongoContract(contract: MongoContract): MongoContract {
    const rawCollections = contract.storage.collections;
    const hydrated: Record<string, MongoCollection> = {};
    for (const [name, raw] of Object.entries(rawCollections)) {
      hydrated[name] =
        raw instanceof MongoCollection ? raw : new MongoCollection(raw as MongoCollectionInput);
    }
    return {
      ...contract,
      storage: {
        ...contract.storage,
        collections: hydrated,
      },
    };
  }

  /**
   * Target-specific class construction from the validated structural
   * data. The target wraps the contract envelope in the family-layer
   * `MongoStorage` class instance, supplying the `namespaces` map
   * (target concretions like `MongoTargetUnspecifiedDatabase`). The
   * leaf collection / index shapes are already family-layer IR-class
   * instances after the hydration walk above.
   */
  protected abstract constructTargetContract(validated: MongoContract): TContract;
}
