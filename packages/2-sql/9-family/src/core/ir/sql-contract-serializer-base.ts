import { ContractValidationError } from '@prisma-next/contract/contract-validation-error';
import { isPlainRecord } from '@prisma-next/contract/is-plain-record';
import type { Contract } from '@prisma-next/contract/types';
import type { ContractSerializer } from '@prisma-next/framework-components/control';
import {
  type AnyEntityKindDescriptor,
  constructEntries,
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import { composeSqlEntityKinds } from '@prisma-next/sql-contract/entity-kinds';
import {
  buildSqlNamespace,
  type SqlNamespaceTablesInput,
  SqlStorage,
  type SqlStorageInput,
  type SqlStorageTypeEntry,
  SqlUnboundNamespace,
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
  entries: type({
    '+': 'ignore',
  }),
});

export type SqlEntityHydrationFactory = (entry: unknown) => unknown;

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
  private readonly entryKinds: ReadonlyMap<string, AnyEntityKindDescriptor>;

  constructor(
    protected readonly entityHydrationRegistry: ReadonlyMap<
      string,
      SqlEntityHydrationFactory
    > = new Map(),
    packEntityKinds: readonly AnyEntityKindDescriptor[] = [],
  ) {
    this.entryKinds = composeSqlEntityKinds(packEntityKinds);
    this.contractSchema =
      packEntityKinds.length > 0 ? createSqlContractSchema(this.entryKinds) : undefined;
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
            : buildSqlNamespace(
                blindCast<
                  SqlNamespaceTablesInput,
                  'hydrateSqlNamespaceEntry returns SqlNamespaceTablesInput when raw is not a NamespaceBase'
                >(namespaceHydrated),
              );
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
    const entriesRaw = parsed.entries;
    const rawEntriesMap =
      entriesRaw !== null && typeof entriesRaw === 'object' && !Array.isArray(entriesRaw)
        ? (entriesRaw as Record<string, unknown>)
        : {};

    const entriesInput: Record<string, Readonly<Record<string, unknown>>> = {};
    for (const [key, innerMap] of Object.entries(rawEntriesMap)) {
      if (innerMap === null || typeof innerMap !== 'object' || Array.isArray(innerMap)) {
        entriesInput[key] = Object.freeze({});
      } else {
        entriesInput[key] = innerMap as Readonly<Record<string, unknown>>;
      }
    }

    const entriesOutput = constructEntries(entriesInput, this.entryKinds, 'fail', id);

    // Always ensure a 'table' key is present (may be empty).
    if (!Object.hasOwn(entriesOutput, 'table')) {
      entriesOutput['table'] = {};
    }

    return blindCast<SqlNamespaceTablesInput, 'hydrated namespace entries input'>({
      id,
      entries: entriesOutput,
    });
  }

  protected hydrateStorageTypeEntry(entry: SqlStorageTypeEntry): SqlStorageTypeEntry {
    if (typeof entry !== 'object' || entry === null) {
      return entry;
    }
    const kind = (entry as { kind?: unknown }).kind;
    if (typeof kind !== 'string') {
      return entry;
    }
    const factory = this.entityHydrationRegistry.get(kind);
    if (factory === undefined) {
      return entry;
    }
    return blindCast<
      SqlStorageTypeEntry,
      'entity registry factory returns SqlStorageTypeEntry for storage.types entries'
    >(factory(entry));
  }

  protected constructTargetContract(hydrated: Contract<SqlStorage>): TContract {
    return hydrated as TContract;
  }
}
