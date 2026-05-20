import { validateContractDomain } from '@prisma-next/contract/validate-domain';
import type { ContractSerializer } from '@prisma-next/framework-components/control';
import {
  createMongoContractSchema,
  MongoCollection,
  type MongoCollectionInput,
  type MongoContract,
  MongoContractSchema,
  validateMongoStorage,
} from '@prisma-next/mongo-contract';
import type { JsonObject } from '@prisma-next/utils/json';
import { type as arktypeType, type Type } from 'arktype';

/**
 * Hydration factory the Mongo family `ContractSerializer` invokes for
 * every entry under a pack-contributed `storage.<ns>.<slotKey>` slot.
 * Mirrors {@link import('../../../../../2-sql/9-family/src/core/ir/sql-contract-serializer-base').SqlNamespaceSlotHydrationFactory}
 * for symmetry across the families. Mongo has no pack contributions
 * today; the registry exists for future entity kinds.
 */
export type MongoNamespaceSlotHydrationFactory = (raw: unknown) => unknown;

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
  private readonly namespaceSlotHydrationRegistry: ReadonlyMap<
    string,
    MongoNamespaceSlotHydrationFactory
  >;
  private readonly contractSchema: Type<unknown> | undefined;

  constructor(
    namespaceSlotHydrationRegistry?: ReadonlyMap<string, MongoNamespaceSlotHydrationFactory>,
    validatorFragments?: ReadonlyMap<string, Type<unknown>>,
  ) {
    this.namespaceSlotHydrationRegistry = namespaceSlotHydrationRegistry ?? new Map();
    // Mirrors the SQL base: only build a fragments-aware schema when
    // pack contributions exist; otherwise the cached module-level
    // default in `contract-schema.ts` covers the validation path.
    this.contractSchema =
      validatorFragments !== undefined && validatorFragments.size > 0
        ? createMongoContractSchema(validatorFragments)
        : undefined;
  }

  /**
   * Hydrate one pack-contributed namespace slot through the registry
   * keyed by `storageSlotKey`. Mirrors the SQL family helper so target
   * serializer overrides have a single per-slot dispatch surface. No
   * Mongo pack registers slots today; the helper exists for symmetry
   * and as the substrate for future entity kinds.
   */
  protected hydrateMongoNamespaceSlot(
    slotKey: string,
    raw: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const hydrate = this.namespaceSlotHydrationRegistry.get(slotKey);
    if (hydrate === undefined) {
      return undefined;
    }
    const slotValue = raw[slotKey];
    if (
      slotValue === undefined ||
      typeof slotValue !== 'object' ||
      slotValue === null ||
      Object.keys(slotValue as Record<string, unknown>).length === 0
    ) {
      return undefined;
    }
    const entries = slotValue as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(entries).map(([entryName, entry]) => [entryName, hydrate(entry)]),
    );
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
   * Family-shared structural validation: parse against the Mongo
   * contract arktype schema, then run framework-shared domain + Mongo
   * family storage checks, then hydrate the validated tree into Mongo
   * Contract IR class instances. Targets can override to add
   * target-specific structural checks; most targets accept the family
   * default.
   *
   * The returned `MongoContract` carries class instances under
   * `storage.namespaces[namespaceId].collections[collectionName]` (each value is a
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
   * `storage.namespaces[nsId].collections[collectionName]` entry from plain
   * data into `MongoCollection` IR-class instances. Idempotent: already-class
   * instances pass through unchanged.
   */
  protected hydrateMongoContract(contract: MongoContract): MongoContract {
    const rawNamespaces = contract.storage.namespaces;
    const hydratedNamespaces = Object.fromEntries(
      Object.entries(rawNamespaces).map(([nsId, nsEnvelope]) => {
        const rawCollections = nsEnvelope.collections ?? {};
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
            collections: hydratedCollections,
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
