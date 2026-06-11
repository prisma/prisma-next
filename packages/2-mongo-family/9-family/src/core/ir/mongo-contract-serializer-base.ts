import { validateContractDomain } from '@prisma-next/contract/validate-domain';
import type { ContractSerializer } from '@prisma-next/framework-components/control';
import {
  createMongoContractSchema,
  MongoCollection,
  type MongoCollectionInput,
  type MongoContract,
  MongoContractSchema,
  namespaceCollections,
  validateMongoStorage,
} from '@prisma-next/mongo-contract';
import { mongoContractCanonicalizationHooks } from '@prisma-next/mongo-contract/canonicalization-hooks';
import type { JsonObject } from '@prisma-next/utils/json';
import { type as arktypeType, type Type } from 'arktype';

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
  private readonly contractSchema: Type<unknown> | undefined;

  constructor(validatorFragments?: ReadonlyMap<string, Type<unknown>>) {
    // Mirrors the SQL base: only build a fragments-aware schema when
    // pack contributions exist; otherwise the cached module-level
    // default in `contract-schema.ts` covers the validation path.
    this.contractSchema =
      validatorFragments !== undefined && validatorFragments.size > 0
        ? createMongoContractSchema(validatorFragments)
        : undefined;
  }

  deserializeContract<T extends TContract = TContract>(json: unknown): T {
    const validated = this.parseMongoContractStructure(json);
    return this.constructTargetContract(validated) as T;
  }

  serializeContract(contract: TContract): JsonObject {
    // Mongo contract class fields are JSON-clean by construction; the
    // cast asserts that. Targets that need to canonicalize on the way
    // out override this method.
    return contract as unknown as JsonObject;
  }

  /**
   * Preserve empty `collections` maps and per-collection payloads. Mongo
   * collections legitimately serialize empty (a declared collection with no
   * schema is valid); SQL tables never do — that asymmetry lives here rather
   * than in the family-agnostic canonicalizer.
   */
  shouldPreserveEmpty = mongoContractCanonicalizationHooks.shouldPreserveEmpty;

  /**
   * Family-shared structural validation: parse against the Mongo
   * contract arktype schema, then run framework-shared domain + Mongo
   * family storage checks, then hydrate the validated tree into Mongo
   * Contract IR class instances. Targets can override to add
   * target-specific structural checks; most targets accept the family
   * default.
   *
   * The returned `MongoContract` carries class instances under
   * `storage.namespaces[namespaceId].entries.collection[collectionName]` (each value is a
   * `MongoCollection`, with nested `MongoIndex` / `MongoValidator` /
   * `MongoCollectionOptions` constructed by the `MongoCollection` constructor).
   * The rest of the contract envelope (models, valueObjects, capabilities, …)
   * remains in plain-JSON form; those IR layers are handled by sibling
   * subsystems and don't sit behind this SPI.
   */
  protected parseMongoContractStructure(json: unknown): MongoContract {
    const schema = this.contractSchema ?? MongoContractSchema;
    const parsed = schema(json);
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
    // re-shapes `storage.namespaces.*.collections` from plain data into IR-class
    // instances, so the `MongoContract` returned here carries class identity
    // under those collections maps (and transitively under `indexes` / `validator`
    // / `options`).
    const validatedShape = parsed as unknown as MongoContract;

    const hydratedContract = this.hydrateMongoContract(validatedShape);

    validateContractDomain(hydratedContract);
    validateMongoStorage(hydratedContract);

    return hydratedContract;
  }

  /**
   * Walk a structurally-validated Mongo contract and convert each
   * `storage.namespaces[nsId].entries.collection[collectionName]` entry from plain
   * data into `MongoCollection` IR-class instances. Idempotent: already-class
   * instances pass through unchanged. Fails closed: an entries key other
   * than `collection` throws naming the kind — never silently dropped.
   */
  protected hydrateMongoContract(contract: MongoContract): MongoContract {
    const rawNamespaces = contract.storage.namespaces;
    const hydratedNamespaces = Object.fromEntries(
      Object.entries(rawNamespaces).map(([nsId, nsEnvelope]) => {
        for (const kind of Object.keys(nsEnvelope.entries)) {
          if (kind !== 'collection') {
            throw new Error(
              `Unknown entries key "${kind}" in namespace "${nsId}"; no hydration factory registered for this entity kind`,
            );
          }
        }
        const rawCollections = namespaceCollections(nsEnvelope);
        const hydratedCollections = Object.fromEntries(
          Object.entries(rawCollections).map(([name, raw]) => [
            name,
            raw instanceof MongoCollection ? raw : new MongoCollection(raw as MongoCollectionInput),
          ]),
        );
        return [
          nsId,
          {
            ...nsEnvelope,
            id: nsEnvelope.id,
            entries: { collection: hydratedCollections },
          },
        ];
      }),
    );
    return {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: hydratedNamespaces,
      },
    };
  }

  /**
   * Target-specific class construction from the validated structural
   * data. The target wraps the contract envelope in the family-layer
   * `MongoStorage` class instance, supplying the `namespaces` map
   * (target concretions like `MongoTargetUnboundDatabase`). The
   * leaf collection / index shapes are already family-layer IR-class
   * instances after the hydration walk above.
   */
  protected abstract constructTargetContract(validated: MongoContract): TContract;
}
