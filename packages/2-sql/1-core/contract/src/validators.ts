import { ContractValidationError } from '@prisma-next/contract/contract-validation-error';
import {
  type Contract,
  type ContractField,
  type ContractModel,
  CrossReferenceSchema,
} from '@prisma-next/contract/types';
import { validateContractDomain } from '@prisma-next/contract/validate-domain';
import { type Namespace, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { type Type, type } from 'arktype';
import { buildSqlNamespaceMap } from './ir/build-sql-namespace';
import { SqlUnboundNamespace } from './ir/sql-unbound-namespace';
import {
  type ForeignKeyInput,
  type ForeignKeyReferenceInput,
  type PrimaryKeyInput,
  type ReferentialAction,
  type SqlModelStorage,
  SqlStorage,
  type SqlStorageInput,
  type StorageTable,
  type StorageTypeInstanceInput,
  type UniqueConstraintInput,
} from './types';

type ColumnDefaultLiteral = {
  readonly kind: 'literal';
  readonly value: string | number | boolean | Record<string, unknown> | unknown[] | null;
};
type ColumnDefaultFunction = { readonly kind: 'function'; readonly expression: string };
const literalKindSchema = type("'literal'");
const functionKindSchema = type("'function'");
const generatorKindSchema = type("'generator'");
const ControlPolicySchema = type("'managed' | 'tolerated' | 'external' | 'observed'");
const generatorIdSchema = type('string').narrow((value, ctx) => {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ? true : ctx.mustBe('a flat generator id');
});

export const ColumnDefaultLiteralSchema = type.declare<ColumnDefaultLiteral>().type({
  kind: literalKindSchema,
  value: 'string | number | boolean | null | unknown[] | Record<string, unknown>',
});

export const ColumnDefaultFunctionSchema = type.declare<ColumnDefaultFunction>().type({
  kind: functionKindSchema,
  expression: 'string',
});

export const ColumnDefaultSchema = ColumnDefaultLiteralSchema.or(ColumnDefaultFunctionSchema);

const ExecutionMutationDefaultValueSchema = type({
  '+': 'reject',
  kind: generatorKindSchema,
  id: generatorIdSchema,
  'params?': 'Record<string, unknown>',
});

const ExecutionMutationDefaultSchema = type({
  '+': 'reject',
  ref: {
    '+': 'reject',
    table: 'string',
    column: 'string',
  },
  'onCreate?': ExecutionMutationDefaultValueSchema,
  'onUpdate?': ExecutionMutationDefaultValueSchema,
});

const ExecutionSchema = type({
  '+': 'reject',
  executionHash: 'string',
  mutations: {
    '+': 'reject',
    defaults: ExecutionMutationDefaultSchema.array().readonly(),
  },
});

const StorageColumnSchema = type({
  '+': 'reject',
  nativeType: 'string',
  codecId: 'string',
  nullable: 'boolean',
  'typeParams?': 'Record<string, unknown>',
  'typeRef?': 'string',
  'default?': ColumnDefaultSchema,
  'control?': ControlPolicySchema,
  'valueSet?': type({
    kind: "'enum' | 'value-set'",
    namespaceId: 'string',
    name: 'string',
    'spaceId?': 'string',
  }),
}).narrow((col, ctx) => {
  if (col.typeParams !== undefined && col.typeRef !== undefined) {
    return ctx.mustBe('a column with either typeParams or typeRef, not both');
  }
  return true;
});

/**
 * Codec-triple entry persisted under `storage.types[name]`. Carries an
 * enumerable literal `kind: 'codec-instance'` discriminator so the
 * polymorphic slot dispatch can distinguish codec triples from
 * class-instance kinds (e.g. `'postgres-enum'`) sharing the slot.
 */
const StorageTypeInstanceSchema = type
  .declare<StorageTypeInstanceInput & { kind: 'codec-instance' }>()
  .type({
    kind: "'codec-instance'",
    codecId: 'string',
    nativeType: 'string',
    typeParams: 'Record<string, unknown>',
  });

/**
 * Postgres native enum entry under `storage.namespaces[namespaceId].entries.type[name]`.
 * Document-scoped `storage.types` carries codec aliases only
 * (`DocumentScopedStorageTypeSchema`).
 */
const PostgresEnumTypeSchema = type({
  kind: "'postgres-enum'",
  'name?': 'string',
  'nativeType?': 'string',
  values: type.string.array().readonly(),
  'control?': ControlPolicySchema,
});

/** Document-scoped `storage.types`: codec triples only. */
const DocumentScopedStorageTypeSchema = StorageTypeInstanceSchema;

/**
 * Storage value-set entry under `storage.namespaces[id].entries.valueSet[name]`.
 * Carries a `kind: 'value-set'` discriminator (enumerable, survives JSON) and an
 * ordered `values` array of codec-encoded permitted values.
 */
export const StorageValueSetSchema = type({
  kind: "'value-set'",
  values: type.string.array().readonly(),
});

/**
 * Domain enum entry under `domain.namespaces[id].enum[name]`.
 * Carries the codec id and an ordered `members` array of `{name, value}` pairs.
 */
export const ContractEnumSchema = type({
  '+': 'reject',
  codecId: 'string',
  members: type({
    name: 'string',
    value: 'string',
  })
    .array()
    .readonly(),
});

const PrimaryKeySchema = type.declare<PrimaryKeyInput>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

const UniqueConstraintSchema = type.declare<UniqueConstraintInput>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

export const IndexSchema = type({
  columns: type.string.array().readonly(),
  'name?': 'string',
  'type?': 'string',
  'options?': 'Record<string, unknown>',
});

export const ForeignKeyReferenceSchema = type({
  '+': 'reject',
  namespaceId: 'string',
  tableName: 'string',
  columns: type.string.array().readonly(),
  'spaceId?': 'string',
}) satisfies Type<ForeignKeyReferenceInput>;

export const ForeignKeySourceSchema = type({
  '+': 'reject',
  namespaceId: 'string',
  tableName: 'string',
  columns: type.string.array().readonly(),
}) satisfies Type<ForeignKeyReferenceInput>;

export const ReferentialActionSchema = type
  .declare<ReferentialAction>()
  .type("'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault'");

export const ForeignKeySchema = type.declare<ForeignKeyInput>().type({
  source: ForeignKeySourceSchema,
  target: ForeignKeyReferenceSchema,
  'name?': 'string',
  'onDelete?': ReferentialActionSchema,
  'onUpdate?': ReferentialActionSchema,
  constraint: 'boolean',
  index: 'boolean',
});

const StorageTableSchema = type({
  '+': 'reject',
  columns: type({ '[string]': StorageColumnSchema }),
  'primaryKey?': PrimaryKeySchema,
  uniques: UniqueConstraintSchema.array().readonly(),
  indexes: IndexSchema.array().readonly(),
  foreignKeys: ForeignKeySchema.array().readonly(),
  'control?': ControlPolicySchema,
});

/**
 * Re-exported so target packs can register their `validatorSchema`
 * fragment without re-declaring the schema for the kinds the family
 * core already validates. Full extraction of enum-specific schemas
 * into the Postgres pack is a follow-up; today the symbol lives here.
 */
export { PostgresEnumTypeSchema };

/**
 * Composes a hardcoded family `fallback` schema with optional
 * pack-contributed `fragments` keyed by the entry's `kind`
 * discriminator. The composition is **additive**, not substitutive:
 *
 * - No fragments registered → entries are validated by `fallback`
 *   alone (the unchanged baseline).
 * - An entry's `kind` matches `fallbackKind` AND a fragment for that
 *   kind is registered → the entry must pass **both** `fallback` and
 *   the fragment. This preserves family-owned invariants (e.g. the
 *   built-in `PostgresEnumType` shape) even when a pack contributes
 *   its own schema for the same kind.
 * - An entry's `kind` matches a registered fragment for some
 *   non-fallback kind → the fragment alone validates the entry.
 *   `fallback` is family-specific (validates a single hardcoded kind)
 *   and would reject any other kind, so it does not apply here.
 * - An entry's `kind` matches no fragment → fall through to
 *   `fallback`.
 */
function namespaceSlotEntrySchema(
  fallback: Type<unknown>,
  fallbackKind: string,
  fragments?: ReadonlyMap<string, Type<unknown>>,
): Type<unknown> {
  if (fragments === undefined || fragments.size === 0) {
    return fallback;
  }
  return type('unknown').narrow((entry, ctx) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return ctx.mustBe('an object');
    }
    const kind = (entry as { kind?: unknown }).kind;
    if (typeof kind === 'string') {
      const fragment = fragments.get(kind);
      if (fragment !== undefined) {
        if (kind === fallbackKind) {
          const baseParsed = fallback(entry);
          if (baseParsed instanceof type.errors) {
            return ctx.reject({ expected: baseParsed.summary });
          }
        }
        const parsed = fragment(entry);
        if (parsed instanceof type.errors) {
          return ctx.reject({ expected: parsed.summary });
        }
        return true;
      }
    }
    const parsed = fallback(entry);
    if (parsed instanceof type.errors) {
      return ctx.reject({ expected: parsed.summary });
    }
    return true;
  });
}

/**
 * Builds the per-namespace entry schema for `storage.namespaces[id]`.
 * Pack-contributed `validatorSchema` fragments — keyed by the
 * descriptor's `discriminator` — validate each entry by matching the
 * entry's `kind` field on the `'entries.type'` slot.
 */
export function createNamespaceEntrySchema(
  fragments?: ReadonlyMap<string, Type<unknown>>,
): Type<unknown> {
  return type({
    '+': 'reject',
    id: 'string',
    'kind?': 'string',
    entries: type({
      '+': 'reject',
      'table?': type({ '[string]': StorageTableSchema }),
      'type?': type({
        '[string]': namespaceSlotEntrySchema(PostgresEnumTypeSchema, 'postgres-enum', fragments),
      }),
      'valueSet?': type({ '[string]': StorageValueSetSchema }),
    }),
  }) as Type<unknown>;
}

/**
 * Builds the storage schema. Pack contributions reach the per-namespace
 * entry shape through {@link createNamespaceEntrySchema}; the
 * document-scoped `storage.types` slot (codec triples only) and the
 * storage hash stay family-shared.
 */
export function createSqlStorageSchema(
  fragments?: ReadonlyMap<string, Type<unknown>>,
): Type<unknown> {
  const namespaceEntry = createNamespaceEntrySchema(fragments);
  return type({
    '+': 'reject',
    storageHash: 'string',
    'types?': type({ '[string]': DocumentScopedStorageTypeSchema }),
    // `__unbound__` is NOT required here: cross-namespace contracts can
    // declare only named namespaces (see cross-namespace FK fixtures). The
    // `__unbound__` brand on `SqlStorageInput['namespaces']` is kept sound at
    // construction time by injecting the unbound singleton when absent
    // (see `validateStorage` / `hydrateSqlStorage`), not by structural require.
    'namespaces?': type({ '[string]': namespaceEntry }),
  }) as Type<unknown>;
}

const StorageSchema = createSqlStorageSchema();

// SQL-specific namespace walk shape (`entries.table` is the SQL family's
// idiom). The wider `object` table value keeps this helper structurally
// compatible with `SqlNamespace` and JSON envelope variants that lose class
// identity.
type NamespacedStorageWalk = {
  readonly namespaces: Readonly<
    Record<
      string,
      Namespace & { readonly entries: { readonly table: Readonly<Record<string, object>> } }
    >
  >;
};

function eachStorageTable(storage: NamespacedStorageWalk) {
  return Object.entries(storage.namespaces).flatMap(([namespaceId, ns]) =>
    Object.entries(ns.entries.table).map(([tableName, table]) => ({
      namespaceId,
      tableName,
      table,
    })),
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findDuplicateValue(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

function isContractFieldType(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  const kind = value['kind'];
  if (kind === 'scalar') {
    if (typeof value['codecId'] !== 'string') return false;
    const typeParams = value['typeParams'];
    if (typeParams !== undefined && !isPlainRecord(typeParams)) return false;
    return true;
  }
  if (kind === 'valueObject') {
    return typeof value['name'] === 'string';
  }
  if (kind === 'union') {
    const members = value['members'];
    if (!Array.isArray(members)) return false;
    return members.every((m) => isContractFieldType(m));
  }
  return false;
}

const ContractFieldTypeSchema = type('unknown').narrow((value, ctx) =>
  isContractFieldType(value) ? true : ctx.mustBe('scalar, valueObject, or union field type'),
);

const ValueSetRefSchema = type({
  kind: "'enum' | 'value-set'",
  namespaceId: 'string',
  name: 'string',
  'spaceId?': 'string',
});

const ModelFieldSchema = type({
  '+': 'reject',
  nullable: 'boolean',
  type: ContractFieldTypeSchema,
  'many?': 'true',
  'dict?': 'true',
  'valueSet?': ValueSetRefSchema,
});

const ModelStorageFieldSchema = type({
  column: 'string',
  'codecId?': 'string',
  'nullable?': 'boolean',
});

const ModelStorageSchema = type({
  table: 'string',
  namespaceId: 'string',
  fields: type({ '[string]': ModelStorageFieldSchema }),
});

const ContractReferenceRelationSchema = type({
  '+': 'reject',
  to: CrossReferenceSchema,
  cardinality: "'1:1' | '1:N' | 'N:1'",
  on: type({
    '+': 'reject',
    localFields: type.string.array().readonly(),
    targetFields: type.string.array().readonly(),
  }),
});

const ContractEmbedRelationSchema = type({
  '+': 'reject',
  to: CrossReferenceSchema,
  cardinality: "'1:1' | '1:N'",
});

const ContractRelationSchema = ContractReferenceRelationSchema.or(ContractEmbedRelationSchema);

const ModelSchema = type({
  storage: ModelStorageSchema,
  'fields?': type({ '[string]': ModelFieldSchema }),
  'relations?': type({ '[string]': ContractRelationSchema }),
  'discriminator?': 'unknown',
  'variants?': 'unknown',
  'base?': CrossReferenceSchema,
  'owner?': 'string',
});

const ContractMetaSchema = type({
  '[string]': 'unknown',
});

/**
 * Builds the full SQL contract schema. The storage subtree threads
 * pack contributions through {@link createSqlStorageSchema}; the rest
 * of the contract envelope is family-shared.
 */
export function createSqlContractSchema(
  fragments?: ReadonlyMap<string, Type<unknown>>,
): Type<unknown> {
  const storage = createSqlStorageSchema(fragments);
  return type({
    '+': 'reject',
    target: 'string',
    targetFamily: "'sql'",
    'coreHash?': 'string',
    profileHash: 'string',
    'capabilities?': 'Record<string, Record<string, boolean>>',
    'extensionPacks?': 'Record<string, unknown>',
    'meta?': ContractMetaSchema,
    'defaultControlPolicy?': ControlPolicySchema,
    'roots?': type({ '[string]': CrossReferenceSchema }),
    domain: type({
      namespaces: type({
        '[string]': type({
          models: type({ '[string]': ModelSchema }),
          'valueObjects?': 'Record<string, unknown>',
          'enum?': type({ '[string]': ContractEnumSchema }),
        }),
      }),
    }),
    storage,
    'execution?': ExecutionSchema,
  }) as Type<unknown>;
}

const SqlContractSchema = createSqlContractSchema();

// NOTE: StorageColumnSchema, StorageTableSchema, and StorageSchema use bare type()
// instead of type.declare<T>().type() because the ColumnDefault union's value field
// includes bigint | Date (runtime-only types after decoding) which cannot be expressed
// in Arktype's JSON validation DSL. The `as SqlStorage` cast in validateStorage() bridges
// the gap between the JSON-safe Arktype output and the runtime TypeScript type.

/**
 * Validates the structural shape of SqlStorage using Arktype.
 *
 * @param value - The storage value to validate
 * @returns The validated storage if structure is valid
 * @throws Error if the storage structure is invalid
 */
export function validateStorage(value: unknown): SqlStorage {
  const result = StorageSchema(value);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Storage validation failed: ${messages}`);
  }
  // Arktype validates the JSON-safe envelope, but the `ColumnDefault`
  // union carries runtime-only `bigint | Date` that the validation DSL
  // can't express (see NOTE above), so bridge the validated shape to the
  // input type. Construction below re-materialises nested IR fields.
  const validated = blindCast<
    SqlStorageInput & { readonly namespaces?: SqlStorageInput['namespaces'] },
    'arktype validated the JSON envelope but its output type is unknown (ColumnDefault carries runtime-only bigint|Date); bridge to the input shape'
  >(result);
  const namespaces = buildSqlNamespaceMap(validated.namespaces ?? {});
  // Compatibility shim: inject the empty unbound singleton when absent so that
  // production code paths which address __unbound__ for table metadata have a
  // slot to read or write into. The `SqlStorageInput['namespaces']` type no
  // longer requires __unbound__, so this is a runtime convenience, not a type
  // invariant.
  const unbound = namespaces[UNBOUND_NAMESPACE_ID] ?? SqlUnboundNamespace.instance;
  return new SqlStorage({
    storageHash: validated.storageHash,
    ...ifDefined('types', validated.types),
    namespaces: { ...namespaces, [UNBOUND_NAMESPACE_ID]: unbound },
  });
}

export function validateModel(value: unknown): unknown {
  const result = ModelSchema(value);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Model validation failed: ${messages}`);
  }
  return result;
}

/**
 * Structural arktype validation of an SQL contract envelope. Internal
 * helper for {@link validateSqlContractFully} — exposed only inside
 * this module, since the family seam-of-record is the
 * `SqlContractSerializerBase.deserializeContract` SPI.
 */
function validateSqlContractStructure<T extends Contract<SqlStorage>>(
  value: unknown,
  contractSchema: Type<unknown>,
): T {
  if (typeof value !== 'object' || value === null) {
    throw new ContractValidationError(
      'Contract structural validation failed: value must be an object',
      'structural',
    );
  }

  const rawValue = value as { targetFamily?: string };
  if (rawValue.targetFamily !== undefined && rawValue.targetFamily !== 'sql') {
    throw new ContractValidationError(
      `Unsupported target family: ${rawValue.targetFamily}`,
      'structural',
    );
  }

  const contractResult = contractSchema(value);

  if (contractResult instanceof type.errors) {
    const messages = contractResult.map((p: { message: string }) => p.message).join('; ');
    throw new ContractValidationError(
      `Contract structural validation failed: ${messages}`,
      'structural',
    );
  }

  // Arktype's inferred output type differs from T due to exactOptionalPropertyTypes
  // and branded hash types — the runtime value is structurally compatible after validation
  return contractResult as unknown as T;
}

/**
 * Validates semantic constraints on SqlStorage that cannot be expressed in Arktype schemas.
 *
 * Returns an array of human-readable error strings. Empty array = valid.
 *
 * Currently checks:
 * - duplicate named primary key / unique / index / foreign key objects within a table
 * - duplicate unique, index, or foreign key declarations within a table
 * - duplicate columns within primary key / unique / index definitions
 * - nullable columns in primary key definitions
 * - `setNull` referential action on a non-nullable FK column (would fail at runtime)
 * - `setDefault` referential action on a non-nullable FK column without a DEFAULT (would fail at runtime)
 */
export function validateStorageSemantics(storage: SqlStorage): string[] {
  const errors: string[] = [];

  for (const { namespaceId, tableName, table: rawTable } of eachStorageTable(storage)) {
    const table = rawTable as StorageTable;
    const namedObjects = new Map<string, string[]>();
    const registerNamedObject = (kind: string, name: string | undefined) => {
      if (!name) return;
      namedObjects.set(name, [...(namedObjects.get(name) ?? []), kind]);
    };

    registerNamedObject('primary key', table.primaryKey?.name);
    for (const unique of table.uniques) {
      registerNamedObject('unique constraint', unique.name);
    }
    for (const index of table.indexes) {
      registerNamedObject('index', index.name);
    }
    for (const fk of table.foreignKeys) {
      registerNamedObject('foreign key', fk.name);
    }

    for (const [name, kinds] of namedObjects) {
      if (kinds.length > 1) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": named object "${name}" is declared multiple times (${kinds.join(', ')})`,
        );
      }
    }

    if (table.primaryKey) {
      const duplicateColumn = findDuplicateValue(table.primaryKey.columns);
      if (duplicateColumn !== undefined) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": primary key contains duplicate column "${duplicateColumn}"`,
        );
      }

      for (const columnName of table.primaryKey.columns) {
        const column = table.columns[columnName];
        if (column?.nullable === true) {
          errors.push(
            `Namespace "${namespaceId}" table "${tableName}": primary key column "${columnName}" is nullable; primary key columns must be NOT NULL`,
          );
        }
      }
    }

    const seenUniqueDefinitions = new Set<string>();
    for (const unique of table.uniques) {
      const duplicateColumn = findDuplicateValue(unique.columns);
      if (duplicateColumn !== undefined) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": unique constraint contains duplicate column "${duplicateColumn}"`,
        );
      }

      const signature = JSON.stringify({ columns: unique.columns });
      if (seenUniqueDefinitions.has(signature)) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": duplicate unique constraint definition on columns [${unique.columns.join(', ')}]`,
        );
        continue;
      }
      seenUniqueDefinitions.add(signature);
    }

    const sortOptions = (o: Record<string, unknown> | undefined): Record<string, unknown> | null =>
      o ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) : null;

    const seenIndexDefinitions = new Set<string>();
    for (const index of table.indexes) {
      const duplicateColumn = findDuplicateValue(index.columns);
      if (duplicateColumn !== undefined) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": index contains duplicate column "${duplicateColumn}"`,
        );
      }

      const signature = JSON.stringify({
        columns: index.columns,
        type: index.type ?? null,
        options: sortOptions(index.options),
      });
      if (seenIndexDefinitions.has(signature)) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": duplicate index definition on columns [${index.columns.join(', ')}]`,
        );
        continue;
      }
      seenIndexDefinitions.add(signature);
    }

    const seenForeignKeyDefinitions = new Set<string>();
    for (const fk of table.foreignKeys) {
      const signature = JSON.stringify({
        source: fk.source,
        target: fk.target,
        onDelete: fk.onDelete ?? null,
        onUpdate: fk.onUpdate ?? null,
        constraint: fk.constraint,
        index: fk.index,
      });
      if (seenForeignKeyDefinitions.has(signature)) {
        errors.push(
          `Namespace "${namespaceId}" table "${tableName}": duplicate foreign key definition on columns [${fk.source.columns.join(', ')}]`,
        );
        continue;
      }
      seenForeignKeyDefinitions.add(signature);
    }

    for (const fk of table.foreignKeys) {
      for (const colName of fk.source.columns) {
        const column = table.columns[colName];
        if (!column) continue;

        if (fk.onDelete === 'setNull' && !column.nullable) {
          errors.push(
            `Namespace "${namespaceId}" table "${tableName}": onDelete setNull on foreign key column "${colName}" which is NOT NULL`,
          );
        }
        if (fk.onUpdate === 'setNull' && !column.nullable) {
          errors.push(
            `Namespace "${namespaceId}" table "${tableName}": onUpdate setNull on foreign key column "${colName}" which is NOT NULL`,
          );
        }
        if (fk.onDelete === 'setDefault' && !column.nullable && column.default === undefined) {
          errors.push(
            `Namespace "${namespaceId}" table "${tableName}": onDelete setDefault on foreign key column "${colName}" which is NOT NULL and has no DEFAULT`,
          );
        }
        if (fk.onUpdate === 'setDefault' && !column.nullable && column.default === undefined) {
          errors.push(
            `Namespace "${namespaceId}" table "${tableName}": onUpdate setDefault on foreign key column "${colName}" which is NOT NULL and has no DEFAULT`,
          );
        }
      }
    }
  }

  return errors;
}

/**
 * SQL storage logical-consistency checks: every model.storage.table
 * resolves to a real table, every model.storage.fields[*].column
 * resolves to a real column, and value-object fields land on JSON-native
 * columns. Throws `ContractValidationError` on the first mismatch.
 */
export function validateModelStorageReferences(contract: Contract<SqlStorage>): void {
  for (const [namespaceId, namespace] of Object.entries(contract.domain.namespaces)) {
    const models = namespace.models as Record<string, ContractModel<SqlModelStorage>>;
    for (const [modelName, model] of Object.entries(models)) {
      const qualifiedName = `${namespaceId}:${modelName}`;
      const storageNamespaceId = model.storage.namespaceId;
      if (storageNamespaceId !== namespaceId) {
        throw new ContractValidationError(
          `Model "${qualifiedName}" storage.namespaceId "${storageNamespaceId}" does not match domain namespace "${namespaceId}"`,
          'storage',
        );
      }

      const storageTable = model.storage.table;
      const rawTable = contract.storage.namespaces[storageNamespaceId]?.entries.table[storageTable];
      if (rawTable === undefined) {
        throw new ContractValidationError(
          `Model "${qualifiedName}" references non-existent table "${storageNamespaceId}.${storageTable}"`,
          'storage',
        );
      }

      const table = rawTable as StorageTable;

      const columnNames = new Set(Object.keys(table.columns));
      for (const [fieldName, field] of Object.entries(model.storage.fields)) {
        if (!columnNames.has(field.column)) {
          throw new ContractValidationError(
            `Model "${qualifiedName}" field "${fieldName}" references non-existent column "${field.column}" in table "${storageTable}"`,
            'storage',
          );
        }
      }

      const JSON_NATIVE_TYPES = new Set(['json', 'jsonb']);
      for (const [fieldName, domainField] of Object.entries(model.fields ?? {})) {
        const f = domainField as ContractField;
        if (f.type?.kind !== 'valueObject') continue;
        const storageField = model.storage.fields[fieldName];
        if (!storageField) continue;
        const column = table.columns[storageField.column];
        if (!column) continue;
        if (!JSON_NATIVE_TYPES.has(column.nativeType)) {
          throw new ContractValidationError(
            `Model "${qualifiedName}" field "${fieldName}" is a value object but storage column "${storageField.column}" has nativeType "${column.nativeType}" (expected json or jsonb)`,
            'storage',
          );
        }
      }
    }
  }
}

/**
 * Cross-table consistency checks for SQL storage: primary key, unique,
 * index, and foreign key column references resolve to real columns;
 * NOT NULL columns don't carry a literal `null` default; FK column
 * counts match their referenced columns. Throws on the first mismatch.
 */
export function validateSqlStorageConsistency(contract: Contract<SqlStorage>): void {
  for (const { namespaceId, tableName, table: rawTable } of eachStorageTable(contract.storage)) {
    const table = rawTable as StorageTable;
    const columnNames = new Set(Object.keys(table.columns));

    if (table.primaryKey) {
      for (const colName of table.primaryKey.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" primaryKey references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const unique of table.uniques) {
      for (const colName of unique.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" unique constraint references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const index of table.indexes) {
      for (const colName of index.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" index references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const [colName, column] of Object.entries(table.columns)) {
      if (!column.nullable && column.default?.kind === 'literal' && column.default.value === null) {
        throw new ContractValidationError(
          `Namespace "${namespaceId}" table "${tableName}" column "${colName}" is NOT NULL but has a literal null default`,
          'storage',
        );
      }
    }

    for (const fk of table.foreignKeys) {
      if (fk.source.namespaceId !== namespaceId || fk.source.tableName !== tableName) {
        throw new ContractValidationError(
          `Namespace "${namespaceId}" table "${tableName}" contains foreignKey with mismatched source coordinates (${fk.source.namespaceId}.${fk.source.tableName})`,
          'storage',
        );
      }

      for (const colName of fk.source.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" foreignKey references non-existent column "${colName}"`,
            'storage',
          );
        }
      }

      if (fk.target.spaceId === undefined) {
        const targetNamespace = contract.storage.namespaces[fk.target.namespaceId];
        const referencedRaw = targetNamespace?.entries.table[fk.target.tableName];
        if (referencedRaw === undefined) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" foreignKey references non-existent table "${fk.target.namespaceId}.${fk.target.tableName}"`,
            'storage',
          );
        }
        const referencedTable = referencedRaw as StorageTable;
        const referencedColumnNames = new Set(Object.keys(referencedTable.columns));
        for (const colName of fk.target.columns) {
          if (!referencedColumnNames.has(colName)) {
            throw new ContractValidationError(
              `Namespace "${namespaceId}" table "${tableName}" foreignKey references non-existent column "${colName}" in table "${fk.target.tableName}"`,
              'storage',
            );
          }
        }
      }

      if (fk.source.columns.length !== fk.target.columns.length) {
        throw new ContractValidationError(
          `Namespace "${namespaceId}" table "${tableName}" foreignKey column count (${fk.source.columns.length}) does not match referenced column count (${fk.target.columns.length})`,
          'storage',
        );
      }
    }
  }
}

export interface ValidateSqlContractFullyOptions {
  /**
   * Precomputed structural schema to validate against. Built once at
   * serializer construction time when the family `ContractSerializer`
   * has folded pack-contributed `validatorSchema` fragments into the
   * per-namespace entry shape; absent for the family-default validator
   * path (no pack contributions). Falls back to the cached default
   * `SqlContractSchema` when omitted.
   */
  readonly contractSchema?: Type<unknown>;
}

/**
 * Full SQL contract validation: structural (arktype) +
 * framework-shared domain + SQL storage logical-consistency + SQL
 * storage semantic + model ↔ storage reference checks. Throws
 * `ContractValidationError` on the first failure. Returns the
 * validated flat-data shape; IR class hydration happens in the SPI
 * base on top of this helper.
 */
export function validateSqlContractFully<T extends Contract<SqlStorage>>(
  value: unknown,
  options?: ValidateSqlContractFullyOptions,
): T {
  const stripped =
    typeof value === 'object' && value !== null
      ? (() => {
          const { schemaVersion: _, _generated: _g, ...rest } = value as Record<string, unknown>;
          return rest;
        })()
      : value;
  const schema = options?.contractSchema ?? SqlContractSchema;
  const validated = validateSqlContractStructure<T>(stripped, schema);
  validateContractDomain({
    roots: validated.roots,
    domain: validated.domain,
  });
  validateSqlStorageConsistency(validated);
  const semanticErrors = validateStorageSemantics(validated.storage);
  if (semanticErrors.length > 0) {
    throw new ContractValidationError(
      `Contract semantic validation failed: ${semanticErrors.join('; ')}`,
      'storage',
    );
  }
  validateModelStorageReferences(validated);
  return validated;
}
