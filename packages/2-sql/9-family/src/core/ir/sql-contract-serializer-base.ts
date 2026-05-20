import { ContractValidationError } from '@prisma-next/contract/contract-validation-error';
import type { Contract } from '@prisma-next/contract/types';
import type { ContractSerializer } from '@prisma-next/framework-components/control';
import { type Namespace, NamespaceBase } from '@prisma-next/framework-components/ir';
import {
  type SqlNamespaceTablesInput,
  SqlStorage,
  type SqlStorageTypeEntry,
  StorageTable,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
import {
  createSqlContractSchema,
  validateSqlContractFully,
} from '@prisma-next/sql-contract/validators';
import type { JsonObject } from '@prisma-next/utils/json';
import type { Type } from 'arktype';

export type SqlEntityHydrationFactory = (entry: unknown) => SqlStorageTypeEntry;

/**
 * Hydration factory the family `ContractSerializer` invokes for every
 * entry under a pack-contributed `storage.<ns>.<slotKey>` slot. The
 * factory receives the raw JSON value (post-structural-validation) and
 * returns the IR-class instance. Already-class instances passed in
 * pass through unchanged is the caller's contract (idempotent).
 */
export type SqlNamespaceSlotHydrationFactory = (raw: unknown) => unknown;

/**
 * SQL family `ContractSerializer` abstract base. Carries the SQL-shared
 * deserialization pipeline:
 *
 * 1. `parseSqlContractStructure` validates the on-disk JSON envelope
 *    against the SQL contract arktype schema (`validateSqlContractFully`)
 *    and returns the validated flat-data shape.
 * 2. `hydrateSqlStorage` walks the validated `storage` subtree and
 *    constructs the family-shared SQL Contract IR class hierarchy
 *    (`SqlStorage` -> `StorageTable` -> `StorageColumn` / `PrimaryKey`
 *    / …). The rest of the contract envelope is JSON-clean primitive
 *    data and passes through unchanged.
 * 3. `constructTargetContract` is the target-specific extension hook;
 *    defaults to identity. Targets that need to attach target-only
 *    fields (e.g. target-specific derived storage fields) override it.
 *
 * Default `serializeContract` is identity over the contract — concrete
 * SQL targets ship JSON-clean class instances, so the contract value
 * can be stringified directly. The non-enumerable family-level `kind`
 * discriminator on `SqlNode` instances stays out of the persisted
 * envelope automatically. Targets that need to canonicalize on the way
 * out (key ordering, dropping computed-only fields) override
 * `serializeContract` directly.
 */
export abstract class SqlContractSerializerBase<TContract extends Contract<SqlStorage>>
  implements ContractSerializer<TContract>
{
  private readonly namespaceSlotHydrationRegistry: ReadonlyMap<
    string,
    SqlNamespaceSlotHydrationFactory
  >;
  private readonly contractSchema: Type<unknown> | undefined;

  constructor(
    private readonly entityTypeRegistry: ReadonlyMap<string, SqlEntityHydrationFactory>,
    namespaceSlotHydrationRegistry?: ReadonlyMap<string, SqlNamespaceSlotHydrationFactory>,
    validatorFragments?: ReadonlyMap<string, Type<unknown>>,
  ) {
    this.namespaceSlotHydrationRegistry = namespaceSlotHydrationRegistry ?? new Map();
    // Only build a fragments-aware contract schema when pack contributions
    // exist. The cached module-level default in `validators.ts` covers the
    // no-contributions case and avoids per-instance schema compilation.
    this.contractSchema =
      validatorFragments !== undefined && validatorFragments.size > 0
        ? createSqlContractSchema(validatorFragments)
        : undefined;
  }

  deserializeContract<T extends TContract = TContract>(json: unknown): T {
    const validated = this.parseSqlContractStructure(json);
    const hydrated = this.hydrateSqlStorage(validated);
    return this.constructTargetContract(hydrated) as T;
  }

  serializeContract(contract: TContract): JsonObject {
    return contract as unknown as JsonObject;
  }

  protected parseSqlContractStructure(json: unknown): Contract<SqlStorage> {
    return validateSqlContractFully<Contract<SqlStorage>>(
      json,
      this.contractSchema !== undefined ? { contractSchema: this.contractSchema } : undefined,
    );
  }

  protected hydrateSqlStorage(validated: Contract<SqlStorage>): Contract<SqlStorage> {
    const types = validated.storage.types;
    const hydratedTypes =
      types !== undefined
        ? Object.fromEntries(
            Object.entries(types).map(([name, entry]) => [
              name,
              this.hydrateStorageTypeEntry(entry),
            ]),
          )
        : undefined;

    const rawNamespaces = validated.storage.namespaces;
    const hydratedNamespaces =
      rawNamespaces !== undefined ? this.hydrateSqlNamespaceMap(rawNamespaces) : undefined;

    return {
      ...validated,
      storage: new SqlStorage({
        storageHash: validated.storage.storageHash,
        ...(hydratedTypes !== undefined ? { types: hydratedTypes } : {}),
        ...(hydratedNamespaces !== undefined ? { namespaces: hydratedNamespaces } : {}),
      }),
    };
  }

  protected hydrateSqlNamespaceMap(
    namespaces: Readonly<Record<string, Namespace | Record<string, unknown>>>,
  ): Readonly<Record<string, Namespace | SqlNamespaceTablesInput>> {
    return Object.fromEntries(
      Object.entries(namespaces).map(([nsId, raw]) => [
        nsId,
        this.hydrateSqlNamespaceEntry(nsId, raw),
      ]),
    );
  }

  protected hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Namespace | Record<string, unknown>,
  ): Namespace | SqlNamespaceTablesInput {
    if (raw instanceof NamespaceBase) {
      return raw;
    }
    const obj = raw as {
      id?: string;
      tables?: Record<string, unknown>;
      types?: Record<string, unknown>;
    };
    const hydratedTypes = this.hydrateNamespaceSlot('types', obj);
    if (
      obj.types !== undefined &&
      Object.keys(obj.types).length > 0 &&
      hydratedTypes === undefined
    ) {
      throw new ContractValidationError(
        'Per-schema database types (e.g. postgres-enum) under storage.namespaces[..].types require PostgresContractSerializer.',
        'structural',
      );
    }
    const tables = Object.fromEntries(
      Object.entries(obj.tables ?? {}).map(([tableName, table]) => [
        tableName,
        table instanceof StorageTable ? table : new StorageTable(table as StorageTableInput),
      ]),
    );
    return {
      id: obj.id ?? nsId,
      tables,
      ...(hydratedTypes !== undefined
        ? { types: hydratedTypes as NonNullable<SqlNamespaceTablesInput['types']> }
        : {}),
    };
  }

  /**
   * Hydrate one pack-contributed namespace slot through the registry
   * keyed by `storageSlotKey`. Returns the per-entry-name hydrated map
   * when the registry knows the slot AND the raw envelope carries
   * non-empty entries; returns `undefined` otherwise. Concrete target
   * serializer overrides of {@link hydrateSqlNamespaceEntry} can reuse
   * this helper to keep the per-slot dispatch identical to the family
   * default while wrapping the result in a target-specific namespace
   * class.
   */
  protected hydrateNamespaceSlot(
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

  protected hydrateStorageTypeEntry(entry: SqlStorageTypeEntry): SqlStorageTypeEntry {
    if (typeof entry !== 'object' || entry === null) {
      return entry;
    }
    const kind = (entry as { kind?: unknown }).kind;
    if (typeof kind !== 'string') {
      return entry;
    }
    const factory = this.entityTypeRegistry.get(kind);
    if (factory === undefined) {
      return entry;
    }
    return factory(entry);
  }

  protected constructTargetContract(hydrated: Contract<SqlStorage>): TContract {
    return hydrated as TContract;
  }
}
