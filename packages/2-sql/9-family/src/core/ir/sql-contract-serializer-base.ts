import type { Contract } from '@prisma-next/contract/types';
import { ContractValidationError } from '@prisma-next/contract/contract-validation-error';
import type { ContractSerializer } from '@prisma-next/framework-components/control';
import { type Namespace, NamespaceBase } from '@prisma-next/framework-components/ir';
import {
  type SqlNamespaceTablesInput,
  SqlStorage,
  type SqlStorageTypeEntry,
  StorageTable,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
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
    return contract as unknown as JsonObject;
  }

  protected parseSqlContractStructure(json: unknown): Contract<SqlStorage> {
    return validateSqlContractFully<Contract<SqlStorage>>(json);
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
    if (obj.types !== undefined && Object.keys(obj.types).length > 0) {
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
    };
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
