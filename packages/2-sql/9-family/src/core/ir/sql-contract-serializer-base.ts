import type { Contract } from '@prisma-next/contract/types';
import type { ContractSerializer } from '@prisma-next/framework-components/control';
import {
  SqlStorage,
  type SqlStorageTablesInput,
  type SqlStorageTypeEntry,
} from '@prisma-next/sql-contract/types';
import { validateSqlContractFully } from '@prisma-next/sql-contract/validators';
import type { JsonObject } from '@prisma-next/utils/json';

export type SqlEntityHydrationFactory = (entry: unknown) => SqlStorageTypeEntry;

/**
 * SQL family `ContractSerializer` abstract base. Carries the SQL-shared
 * deserialization pipeline:
 *
 * 1. `parseSqlContractStructure` validates the on-disk JSON envelope
 *    against the SQL contract arktype schema (`validateSqlContract`)
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
    // Round-trip through JSON so any class instances (notably `SqlStorage`,
    // which exposes a flat `tables` view) are reduced to their serialized
    // JSON form (the FR15 nested envelope from `toJSON`) before the
    // structural validator runs. This mirrors what `validateContract` does
    // in the family control-instance.
    const plainJson = JSON.parse(JSON.stringify(json));
    // `parseSqlContractStructure` -> `validateSqlContractFully` runs
    // arktype structural validation, framework-shared domain checks,
    // and SQL storage consistency/semantic/model-ref checks against the
    // validated JSON envelope (which the consistency helpers walk via
    // `iterateTablesWithCoords`). Hydration below lifts the validated
    // envelope into the IR class hierarchy without re-running checks.
    const validated = this.parseSqlContractStructure(plainJson);
    const hydrated = this.hydrateSqlStorage(validated);
    return this.constructTargetContract(hydrated);
  }

  serializeContract(contract: TContract): JsonObject {
    // Round-trip through JSON to invoke each IR class's `toJSON`
    // projection (notably `SqlStorage.toJSON`, which emits the FR15
    // nested-by-namespace envelope) and collapse the class instances
    // to plain data the downstream canonicaliser can walk. Targets
    // that need to strip target-only enumerable fields override this
    // method directly.
    return JSON.parse(JSON.stringify(contract)) as JsonObject;
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
   * `ForeignKeyReference`, and `StorageTypeInstance`. The rest of the
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
    // Persisted `storage.types` is the FR15 nested-by-namespace shape
    // (`Record<NamespaceId, Record<TypeName, …>>`); the hydrator walks
    // it bucket-by-bucket so the discriminator dispatch sees each entry
    // (not the enclosing namespace bucket). The validator already
    // rejected any envelope that does not match the canonical nested
    // shape, so hydration neither stamps nor reshapes anything — it
    // lifts the validated envelope into the IR class hierarchy as-is.
    const types = validated.storage.types as
      | Readonly<Record<string, Readonly<Record<string, SqlStorageTypeEntry>>>>
      | undefined;
    const hydratedTypes =
      types !== undefined
        ? Object.fromEntries(
            Object.entries(types).map(([namespaceId, bucket]) => [
              namespaceId,
              Object.fromEntries(
                Object.entries(bucket).map(([name, entry]) => [
                  name,
                  this.hydrateStorageTypeEntry(entry),
                ]),
              ),
            ]),
          )
        : undefined;

    // `validated.storage.tables` carries the FR15 nested-by-namespace
    // map on the wire — the only shape `validateSqlContractFully` accepts
    // — but its static type is the deprecated flat-by-name view (kept
    // structurally assignable to `SqlStorage` so user-facing emitted
    // contract types remain compatible). Narrow the cast to just the
    // property whose runtime shape we know.
    return {
      ...validated,
      storage: new SqlStorage({
        storageHash: validated.storage.storageHash,
        tables: validated.storage.tables as unknown as SqlStorageTablesInput,
        ...(hydratedTypes !== undefined ? { types: hydratedTypes } : {}),
        namespaces: validated.storage.namespaces,
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
