import type { Contract } from '@prisma-next/contract/types';
import type { ContractSerializer } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, type SqlStorageTypeEntry } from '@prisma-next/sql-contract/types';
import { validateSqlContractFully } from '@prisma-next/sql-contract/validators';
import type { JsonObject } from '@prisma-next/utils/json';

export type SqlEntityHydrationFactory = (entry: unknown) => SqlStorageTypeEntry;

/**
 * Convert a JSON-validated storage envelope to the canonical FR15
 * nested-by-namespace shape that `SqlStorage` expects. Production-emitted
 * JSON (via `SqlStorage.toJSON`) already arrives nested and passes
 * through. Legacy fixtures using the flat `tables: { <name>: { … } }`
 * shape are bucketed under the unbound sentinel here, and FK targets
 * missing a namespace coordinate inherit the source table's coordinate
 * (the same rule the TS builder applies at the caller boundary).
 */
function normalizeStorageForHydration(
  storage: Contract<SqlStorage>['storage'],
): Contract<SqlStorage>['storage'] {
  const record = storage as unknown as Record<string, unknown>;
  // SqlStorage class instances expose `tables` as the flat-by-name
  // view; the FR15 nested truth lives on the (non-enumerable)
  // `tablesByNamespace` back-pointer. Read it directly so we don't
  // misclassify an instance's flat projection as legacy flat *input*.
  const nestedView = (storage as unknown as { tablesByNamespace?: unknown }).tablesByNamespace;
  if (nestedView !== undefined && typeof nestedView === 'object' && nestedView !== null) {
    return {
      ...(storage as object),
      tables: nestedView as Readonly<Record<string, Readonly<Record<string, unknown>>>>,
    } as unknown as Contract<SqlStorage>['storage'];
  }
  const tables = record['tables'];
  if (tables === undefined || typeof tables !== 'object' || tables === null) {
    return storage;
  }
  const tablesRecord = tables as Record<string, unknown>;
  if (looksLikeFlatTableMap(tablesRecord)) {
    const bucket: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(tablesRecord)) {
      bucket[name] = stampNamespaceOnTable(entry, UNBOUND_NAMESPACE_ID);
    }
    return {
      ...(storage as object),
      tables: { [UNBOUND_NAMESPACE_ID]: bucket },
    } as unknown as Contract<SqlStorage>['storage'];
  }
  const rewrittenTables: Record<string, unknown> = {};
  let changed = false;
  for (const [namespaceId, namespaceEntry] of Object.entries(tablesRecord)) {
    if (typeof namespaceEntry !== 'object' || namespaceEntry === null) {
      rewrittenTables[namespaceId] = namespaceEntry;
      continue;
    }
    const inner: Record<string, unknown> = {};
    for (const [tableName, tableEntry] of Object.entries(
      namespaceEntry as Record<string, unknown>,
    )) {
      inner[tableName] = stampNamespaceOnTable(tableEntry, namespaceId);
      if (inner[tableName] !== tableEntry) changed = true;
    }
    rewrittenTables[namespaceId] = inner;
  }
  if (!changed) return storage;
  return {
    ...(storage as object),
    tables: rewrittenTables,
  } as unknown as Contract<SqlStorage>['storage'];
}

function looksLikeFlatTableMap(tables: Record<string, unknown>): boolean {
  for (const value of Object.values(tables)) {
    if (typeof value !== 'object' || value === null) continue;
    return 'columns' in (value as Record<string, unknown>);
  }
  return false;
}

function stampNamespaceOnTable(entry: unknown, namespaceId: string): unknown {
  if (typeof entry !== 'object' || entry === null) return entry;
  const e = entry as Record<string, unknown>;
  const next: Record<string, unknown> =
    typeof e['namespaceId'] === 'string' ? { ...e } : { namespaceId, ...e };
  const sourceNamespaceId =
    typeof next['namespaceId'] === 'string' ? (next['namespaceId'] as string) : namespaceId;
  const fks = next['foreignKeys'];
  if (Array.isArray(fks)) {
    next['foreignKeys'] = fks.map((fk) => {
      if (typeof fk !== 'object' || fk === null) return fk;
      const fkEntry = fk as Record<string, unknown>;
      const target = fkEntry['target'];
      if (
        typeof target !== 'object' ||
        target === null ||
        typeof (target as Record<string, unknown>)['namespaceId'] === 'string'
      ) {
        return fk;
      }
      return {
        ...fkEntry,
        target: { namespaceId: sourceNamespaceId, ...(target as Record<string, unknown>) },
      };
    });
  }
  return next;
}

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
    // `parseSqlContractStructure` -> `validateSqlContractFully` runs
    // arktype structural validation, framework-shared domain checks,
    // and SQL storage consistency/semantic/model-ref checks against the
    // validated JSON envelope (which the consistency helpers walk via
    // `iterateTablesWithCoords`). Hydration below lifts the validated
    // envelope into the IR class hierarchy without re-running checks.
    const validated = this.parseSqlContractStructure(json);
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
    // (not the enclosing namespace bucket). When the persisted envelope
    // uses the legacy flat shape (legacy fixtures, hand-rolled JSON),
    // the family-shared validator already normalised it for structural
    // validation; we mirror that normalisation here so `SqlStorage`
    // receives the canonical nested shape (with namespaceId stamped on
    // every table) regardless of which input form arrived.
    const normalizedStorage = normalizeStorageForHydration(validated.storage);
    const types = normalizedStorage.types as
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

    return {
      ...validated,
      storage: new SqlStorage({
        ...normalizedStorage,
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
