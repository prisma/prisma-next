import type { Contract } from '@prisma-next/contract/types';
import type { ContractSerializer } from '@prisma-next/framework-components/control';
import { SqlStorage, type SqlStorageTypeEntry } from '@prisma-next/sql-contract/types';
import { validateSqlContractFully } from '@prisma-next/sql-contract/validators';
import type { JsonObject } from '@prisma-next/utils/json';

export type SqlEntityHydrationFactory = (entry: unknown) => SqlStorageTypeEntry;

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
  constructor(
    private readonly entityTypeRegistry: ReadonlyMap<string, SqlEntityHydrationFactory>,
  ) {}

  deserializeContract(json: unknown): TContract {
    const validated = this.parseSqlContractStructure(json);
    const hydrated = this.hydrateSqlStorage(validated);
    return this.constructTargetContract(hydrated);
  }

  serializeContract(contract: TContract): JsonObject {
    // Targets that ship enumerable runtime-only fields must override
    // this method (mirroring `MongoTargetContractSerializer.serializeContract`)
    // to construct the persisted envelope explicitly; the default identity
    // works only when every enumerable own property belongs in the JSON.
    return contract as unknown as JsonObject;
  }

  /**
   * Family-shared validation pipeline (delegates to
   * `validateSqlContractFully` in `@prisma-next/sql-contract/validators`):
   * structural arktype + framework-shared domain + SQL storage
   * logical-consistency + SQL storage semantic + model ↔ storage
   * reference checks. Subclasses override to add target-specific
   * structural checks before hydration; the family default suffices
   * for targets whose contract shape is the SQL-shared shape
   * (Postgres, SQLite today).
   */
  protected parseSqlContractStructure(json: unknown): Contract<SqlStorage> {
    return validateSqlContractFully<Contract<SqlStorage>>(json);
  }

  /**
   * Family-shared hydration walker. Lifts the validated flat-data
   * `storage` subtree into the SQL Contract IR class hierarchy by
   * constructing a single `SqlStorage` instance — its constructor
   * cascades nested instantiation of `StorageTable`, `StorageColumn`,
   * `PrimaryKey`, `UniqueConstraint`, `Index`, `ForeignKey`,
   * `ForeignKeyReferences`, and `StorageTypeInstance`. The rest of the
   * contract envelope (target identity, hashes, capabilities, models,
   * meta, …) is JSON-clean primitive data and passes through unchanged.
   *
   * Polymorphic `storage.types` entries are normalised before the
   * `SqlStorage` constructor runs: when an entry carries an enumerable
   * string `kind`, the serializer looks up a pack-registered hydration
   * factory for that discriminator and delegates reconstruction. Entries
   * with no registered factory pass through unchanged (codec-typed JSON
   * stays codec-typed until `SqlStorage` normalises it).
   */
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

    return {
      ...validated,
      storage: new SqlStorage({
        ...validated.storage,
        ...(hydratedTypes !== undefined ? { types: hydratedTypes } : {}),
      }),
    };
  }

  /**
   * Per-entry hydration dispatcher for `storage.types`. When `kind` is a
   * string and the constructor registry supplies a factory for that key,
   * the factory returns the hydrated `SqlStorageTypeEntry`. Otherwise the
   * entry passes through unchanged for `SqlStorage` to normalise.
   */
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

  /**
   * Target-specific construction hook. Defaults to identity; targets
   * that need to wrap the hydrated contract (e.g. attach target-only
   * derived fields, narrow the contract type to a target-specific
   * subtype) override.
   */
  protected constructTargetContract(hydrated: Contract<SqlStorage>): TContract {
    return hydrated as TContract;
  }
}
