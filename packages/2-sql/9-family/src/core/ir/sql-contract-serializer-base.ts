import { ContractValidationError } from '@prisma-next/contract/contract-validation-error';
import type { Contract } from '@prisma-next/contract/types';
import type { ContractSerializer } from '@prisma-next/framework-components/control';
import {
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import {
  buildSqlNamespace,
  type SqlNamespaceTablesInput,
  SqlStorage,
  type SqlStorageInput,
  type SqlStorageTypeEntry,
  SqlUnboundNamespace,
  StorageTable,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
import {
  createSqlContractSchema,
  validateSqlContractFully,
} from '@prisma-next/sql-contract/validators';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import type { JsonObject } from '@prisma-next/utils/json';
import { type Type, type } from 'arktype';

const NamespaceRawSchema = type({
  id: 'string',
  'kind?': 'string',
  // Undeclared keys (`tables`, `enum`, and any pack-contributed slot maps)
  // intentionally pass through; the slot loop below iterates them by name.
  '+': 'ignore',
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
  private readonly contractSchema: Type<unknown> | undefined;

  constructor(
    private readonly entityTypeRegistry: ReadonlyMap<string, SqlEntityHydrationFactory> = new Map(),
    validatorFragments?: ReadonlyMap<string, Type<unknown>>,
  ) {
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

  shouldPreserveEmpty = sqlContractCanonicalizationHooks.shouldPreserveEmpty;

  sortStorage = sqlContractCanonicalizationHooks.sortStorage;

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
    if (rawNamespaces === undefined) {
      throw new ContractValidationError(
        'Contract storage.namespaces is required after structural validation',
        'structural',
      );
    }
    const hydratedNamespaces = this.hydrateSqlNamespaceMap(rawNamespaces);
    // Compatibility shim: production code that addresses `__unbound__` for table
    // metadata lookups (collection-contract, query-plan-mutations, model-accessor,
    // query-plan-meta, where-binding) uses optional chaining and tolerates absence,
    // but runtime-qualification (TML-2605) has not yet landed cross-namespace table
    // routing. Injecting the empty singleton here keeps helpers that augment the
    // deserialized JSON (e.g. buildMixedPolyContract) working by providing a slot to
    // write into. Once runtime-qualification routes table lookups by namespace, this
    // shim should be removed.
    const unbound = hydratedNamespaces[UNBOUND_NAMESPACE_ID] ?? SqlUnboundNamespace.instance;

    return {
      ...validated,
      storage: new SqlStorage({
        storageHash: validated.storage.storageHash,
        ...ifDefined('types', hydratedTypes),
        // Cast narrows the result of hydrateSqlNamespaceMap from the wider
        // framework `Namespace` to the SQL-family `SqlNamespace`.
        namespaces: blindCast<
          SqlStorageInput['namespaces'],
          'hydrated SQL namespaces are SqlNamespace instances (family hydration guarantees this)'
        >({ ...hydratedNamespaces, [UNBOUND_NAMESPACE_ID]: unbound }),
      }),
    };
  }

  protected hydrateSqlNamespaceMap(
    namespaces: Readonly<Record<string, Namespace | Record<string, unknown>>>,
  ): Readonly<Record<string, Namespace>> {
    return Object.fromEntries(
      Object.entries(namespaces).map(([nsId, namespaceEntryRaw]) => {
        // Raw entries passed structural validation; hydrate materialises family IR class instances.
        const namespaceHydrated = this.hydrateSqlNamespaceEntry(nsId, namespaceEntryRaw);
        const namespaceMaterialised =
          namespaceHydrated instanceof NamespaceBase
            ? namespaceHydrated
            : buildSqlNamespace(namespaceHydrated);
        return [nsId, namespaceMaterialised];
      }),
    );
  }

  protected hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Namespace | Record<string, unknown>,
  ): Namespace | SqlNamespaceTablesInput {
    if (raw instanceof NamespaceBase) {
      return raw;
    }
    const rawRecord = isPlainRecord(raw) ? raw : {};
    const id = typeof rawRecord['id'] === 'string' ? rawRecord['id'] : nsId;
    const parsed = NamespaceRawSchema({ ...rawRecord, id });
    if (parsed instanceof type.errors) {
      const messages = parsed.map((p: { message: string }) => p.message).join('; ');
      throw new ContractValidationError(`Namespace hydration failed: ${messages}`, 'structural');
    }
    const result: Record<string, unknown> = { id };

    for (const [propertyKey, slotValue] of Object.entries(parsed)) {
      if (propertyKey === 'id') continue;
      if (slotValue === null || typeof slotValue !== 'object') continue;

      if (propertyKey === 'tables') {
        result['tables'] = Object.fromEntries(
          Object.entries(slotValue as Record<string, unknown>).map(([tableName, table]) => [
            tableName,
            table instanceof StorageTable ? table : new StorageTable(table as StorageTableInput),
          ]),
        );
        continue;
      }

      const hydratedSlot = Object.fromEntries(
        Object.entries(slotValue as Record<string, unknown>).map(([entryName, entry]) => {
          if (typeof entry !== 'object' || entry === null) {
            return [entryName, entry];
          }
          const kind = (entry as { kind?: unknown }).kind;
          if (typeof kind === 'string') {
            const factory = this.entityTypeRegistry.get(kind);
            if (factory !== undefined) {
              return [entryName, factory(entry)];
            }
          }
          return [entryName, entry];
        }),
      );
      if (Object.keys(hydratedSlot).length > 0) {
        result[propertyKey] = hydratedSlot;
      }
    }

    const enumRaw = rawRecord['enum'];
    if (enumRaw !== undefined && typeof enumRaw === 'object' && enumRaw !== null) {
      for (const entry of Object.values(enumRaw as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) continue;
        const kind = (entry as { kind?: unknown }).kind;
        if (typeof kind === 'string' && this.entityTypeRegistry.get(kind) === undefined) {
          throw new ContractValidationError(
            `Entry kind '${kind}' has no registered hydration factory.`,
            'structural',
          );
        }
      }
    }

    const tables = (result['tables'] ?? {}) as Record<string, StorageTable>;
    const enumSlot = result['enum'] as NonNullable<SqlNamespaceTablesInput['enum']> | undefined;
    return {
      ...result,
      tables,
      ...(enumSlot !== undefined ? { enum: enumSlot } : {}),
    } as SqlNamespaceTablesInput;
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
