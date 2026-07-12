import type { ColumnDefault } from '@prisma-next/contract/types';
import type { SqlDescribedContractSpace } from '@prisma-next/family-sql/control';
import type {
  DefaultMappingOptions,
  EnumInfo,
  PslNativeTypeAttribute,
  PslPrinterOptions,
  PslTypeMap,
  RelationField,
} from '@prisma-next/family-sql/psl-infer';
import {
  buildChildRelationField,
  deriveRelationFieldName,
  inferRelations,
  mapDefault,
  parseRawDefault,
  toEnumMemberName,
  toEnumName,
  toFieldName,
  toModelName,
  toNamedTypeName,
} from '@prisma-next/family-sql/psl-infer';
import {
  coordinateKey,
  elementCoordinates,
  isPlainRecord,
} from '@prisma-next/framework-components/ir';
import type {
  PslAttribute,
  PslAttributeArgument,
  PslDocumentAst,
  PslExtensionBlock,
  PslExtensionBlockParamValue,
  PslField,
  PslFieldAttribute,
  PslModel,
  PslModelAttribute,
  PslNamedTypeDeclaration,
  PslSpan,
  PslTypeConstructorCall,
  PslTypesBlock,
} from '@prisma-next/framework-components/psl-ast';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@prisma-next/framework-components/psl-ast';
import type { SqlModelStorage } from '@prisma-next/sql-contract/types';
import type { SqlColumnIR, SqlForeignKeyIR } from '@prisma-next/sql-schema-ir/types';
import { SqlSchemaIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { PostgresNativeEnum } from '../postgres-native-enum';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { createPostgresDefaultMapping } from './postgres-default-mapping';
import { createPostgresTypeMap } from './postgres-type-map';

const SYNTHETIC_SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

const PSL_SCALAR_TYPE_NAMES = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
]);

type ResolvedColumnFieldName = {
  readonly fieldName: string;
  readonly fieldMap?: string | undefined;
};

type TableColumnFieldNameMap = ReadonlyMap<string, ResolvedColumnFieldName>;

type NamedTypeRegistryEntry = {
  readonly name: string;
  readonly baseType: string;
  readonly nativeTypeAttribute: PslNativeTypeAttribute;
};

type NamedTypeRegistry = {
  readonly entriesByKey: Map<string, NamedTypeRegistryEntry>;
  readonly usedNames: Set<string>;
};

type TopLevelNameResult = {
  readonly name: string;
  readonly map?: string | undefined;
};

/**
 * Coordinates every element a set of already-assembled contracts declare,
 * mapped to the {@link SqlDescribedContractSpace} that owns it and keyed by
 * the shared {@link coordinateKey} helper. `contract infer` uses this to omit
 * database elements a stack extension pack's contract space already
 * describes — reusing the same coordinate walk the contract-space aggregate
 * and cross-space collision check use (`elementCoordinates`), rather than a
 * bespoke per-entity-kind membership test — and, for a foreign key whose
 * referenced table an entry owns, to resolve the qualified cross-space
 * relation it describes.
 */
function describedContractOwners(
  describedContracts: readonly SqlDescribedContractSpace[],
): ReadonlyMap<string, SqlDescribedContractSpace> {
  const owners = new Map<string, SqlDescribedContractSpace>();
  for (const entry of describedContracts) {
    for (const coordinate of elementCoordinates(entry.contract.storage)) {
      owners.set(coordinateKey(coordinate), entry);
    }
  }
  return owners;
}

/**
 * The domain model a described contract maps a `(namespaceId, tableName)`
 * storage coordinate to, plus the pack's own space id and column→field-name
 * mapping — everything `buildModel`/`buildRelationField` need to emit the
 * cross-space relation `<spaceId>:<namespaceId>.<modelName>` and resolve its
 * `references` argument to the pack's own field names rather than a generic
 * column-name guess.
 */
type CrossSpaceTarget = {
  readonly spaceId: string;
  readonly namespaceId: string;
  readonly modelName: string;
  readonly fieldNamesByColumn: TableColumnFieldNameMap;
};

function resolveCrossSpaceTarget(
  owner: SqlDescribedContractSpace,
  namespaceId: string,
  tableName: string,
): CrossSpaceTarget | undefined {
  const domainNamespace = owner.contract.domain.namespaces[namespaceId];
  if (domainNamespace === undefined) {
    return undefined;
  }

  for (const [modelName, model] of Object.entries(domainNamespace.models)) {
    const storage = blindCast<SqlModelStorage, 'SQL contract model storage'>(model.storage);
    if (storage.namespaceId !== namespaceId || storage.table !== tableName) {
      continue;
    }

    const fieldNamesByColumn = new Map<string, ResolvedColumnFieldName>();
    for (const [fieldName, fieldStorage] of Object.entries(storage.fields)) {
      fieldNamesByColumn.set(fieldStorage.column, { fieldName });
    }

    return { spaceId: owner.spaceId, namespaceId, modelName, fieldNamesByColumn };
  }

  return undefined;
}

type ForeignKeyResolution = {
  /** `tables`, with every cross-space or dangling foreign key removed. */
  readonly tables: Record<string, SqlTableIR>;
  /** Cross-space relation fields to merge onto `inferRelations`'s output, keyed by host table name. */
  readonly extraRelationsByTable: ReadonlyMap<string, readonly RelationField[]>;
  /** Synthetic field-name maps for cross-space-referenced pack tables, merged into `fieldNamesByTable`. */
  readonly crossSpaceFieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>;
};

/**
 * Classifies every foreign key on a surviving table into one of three cases.
 * A foreign key that carries a `referencedSchema` is checked against the
 * pack-owned coordinates first, so a pack-owned target wins even when a local
 * table happens to share its bare name; only foreign keys with no owned
 * coordinate fall through to the local/dangling distinction.
 *
 * - **Cross-space**: `referencedSchema` is set and a described contract owns
 *   the coordinate `(referencedSchema, 'table', referencedTable)`. The
 *   referenced table is absent from the tree (omitted because the pack
 *   describes it, or never introspected — `contract infer` walks a single
 *   namespace). Removed from `foreignKeys` (so `inferRelations` never falls
 *   back to a bare, unqualified table name for it) and replaced with a
 *   `RelationField` qualified with the owning pack's space id and namespace
 *   id. `owners` holds only pack-declared coordinates, so an app's own table
 *   (e.g. `public.users`) is never owned and cannot be captured here.
 * - **Local**: not a pack-owned coordinate, and the referenced table survived
 *   introspection — left untouched, `inferRelations` handles it as before.
 * - **Dangling**: not a pack-owned coordinate, and the referenced table is
 *   neither in the tree nor owned by any described contract. Removed from
 *   `foreignKeys`, keeping the scalar column, rather than emitting a relation
 *   to a model that was never defined.
 *
 * A pack that owns the referenced coordinate but declares no domain model
 * mapped to it is malformed; that case throws rather than degrading to a
 * silent drop, which would contradict the dangling definition above.
 */
function resolveForeignKeys(
  tables: Readonly<Record<string, SqlTableIR>>,
  owners: ReadonlyMap<string, SqlDescribedContractSpace>,
): ForeignKeyResolution {
  const resultTables: Record<string, SqlTableIR> = {};
  const extraRelationsByTable = new Map<string, RelationField[]>();
  const crossSpaceFieldNamesByTable = new Map<string, TableColumnFieldNameMap>();

  for (const [tableName, table] of Object.entries(tables)) {
    const keptForeignKeys: SqlForeignKeyIR[] = [];

    for (const fk of table.foreignKeys) {
      if (fk.referencedSchema !== undefined) {
        const owner = owners.get(
          coordinateKey({
            namespaceId: fk.referencedSchema,
            entityKind: 'table',
            entityName: fk.referencedTable,
          }),
        );
        if (owner !== undefined) {
          const target = resolveCrossSpaceTarget(owner, fk.referencedSchema, fk.referencedTable);
          if (target === undefined) {
            throw new Error(
              `contract infer: described contract space "${owner.spaceId}" owns storage ` +
                `coordinate "${fk.referencedSchema}.${fk.referencedTable}" but declares no ` +
                'domain model mapped to it. A pack that describes a table must also declare the ' +
                'domain model it maps to; this pack is malformed.',
            );
          }

          if (!crossSpaceFieldNamesByTable.has(fk.referencedTable)) {
            crossSpaceFieldNamesByTable.set(fk.referencedTable, target.fieldNamesByColumn);
          }

          const fieldName = deriveRelationFieldName(fk.columns, fk.referencedTable);
          const optional = fk.columns.some(
            (columnName) => table.columns[columnName]?.nullable ?? false,
          );
          const relationField: RelationField = {
            ...buildChildRelationField(fieldName, target.modelName, fk, optional),
            typeNamespaceId: target.namespaceId,
            typeContractSpaceId: target.spaceId,
          };

          const existingRelations = extraRelationsByTable.get(tableName);
          if (existingRelations) {
            existingRelations.push(relationField);
          } else {
            extraRelationsByTable.set(tableName, [relationField]);
          }
          continue;
        }
      }

      // Not a pack-owned coordinate: keep the foreign key if the referenced
      // table survived introspection (local), otherwise drop it while keeping
      // the scalar column (dangling).
      if (tables[fk.referencedTable] !== undefined) {
        keptForeignKeys.push(fk);
      }
    }

    resultTables[tableName] =
      keptForeignKeys.length === table.foreignKeys.length
        ? table
        : new SqlTableIR({ ...table, foreignKeys: keptForeignKeys });
  }

  return { tables: resultTables, extraRelationsByTable, crossSpaceFieldNamesByTable };
}

/**
 * Infers a PSL AST (for `printPsl`) from an introspected Postgres schema tree.
 *
 * Target-owned inference: it walks the `PostgresDatabaseSchemaNode` tree and
 * owns the Postgres dialect knowledge — the native type map and default map.
 * Relation inference, name transforms, generic default mapping, and raw-default
 * parsing are shape-neutral utilities imported from the SQL family.
 *
 * This slice emits relational-only PSL, byte-identical to the prior flat
 * inference: the tree's tables (across its namespaces — `contract infer`
 * introspects a single live namespace) are gathered into the model set and
 * emitted as one `UNSPECIFIED_PSL_NAMESPACE_ID` bucket. Top-level entities
 * (policies/roles → PSL extension blocks) are a later slice.
 *
 * `describedContracts` — the stack's extension packs' already-assembled
 * contracts, each paired with its space id — is consulted while gathering
 * tables: a table whose coordinate `(schemaName, 'table', tableName)` one of
 * those contracts already declares is omitted, before the duplicate-name
 * check below and before relation inference, so it cannot spuriously
 * collide with an app table and never contributes a bare relation field. A
 * surviving table's foreign key into an omitted, pack-owned table is not
 * dropped: {@link resolveForeignKeys} rewrites it into a relation qualified
 * with the pack's space id (`<spaceId>:<namespaceId>.<Model>`) instead.
 */
export function inferPostgresPslContract(
  tree: PostgresDatabaseSchemaNode,
  describedContracts?: readonly SqlDescribedContractSpace[],
): PslDocumentAst {
  const namespaces = Object.values(tree.namespaces);
  const owners = describedContractOwners(describedContracts ?? []);
  const enumOwners = describedNativeEnumOwnersByTypeName(describedContracts ?? []);

  // Native enum adoption: each namespace's introspected `enums` nodes become
  // `native_enum` blocks + `pg.enum(<Name>)` columns, minus the types a
  // described pack contract already declares (matched by TYPE NAME — see
  // describedNativeEnumOwnersByTypeName). Transitional grade gap: an
  // inferred block carries no explicit `control` and inherits the contract's
  // `defaultControl`; under `defaultControl: 'managed'` the planner does not
  // yet enforce the native enum lifecycle (CREATE TYPE / DROP TYPE / ADD
  // VALUE) — that lands with Phase 2 of projects/native-postgres-enums/spec.md,
  // making the grade true retroactively with no contract change.
  const enumDefinitions = new Map<string, readonly string[]>();
  const packOwnedEnumTypesByNamespace = new Map<string, Map<string, string>>();
  const enumNamespaceNames = new Set<string>();
  for (const namespace of namespaces) {
    for (const { typeName, members } of namespace.nativeEnums) {
      const owner = enumOwners.get(
        coordinateKey({
          namespaceId: namespace.schemaName,
          entityKind: 'native_enum',
          entityName: typeName,
        }),
      );
      if (owner !== undefined) {
        const owned = packOwnedEnumTypesByNamespace.get(namespace.schemaName) ?? new Map();
        // Columns reference the type either bare or schema-qualified —
        // `format_type` qualifies a type outside the connection's
        // search_path — so both spellings are owned.
        owned.set(typeName, owner.spaceId);
        owned.set(`${namespace.schemaName}.${typeName}`, owner.spaceId);
        packOwnedEnumTypesByNamespace.set(namespace.schemaName, owned);
        continue;
      }
      enumDefinitions.set(typeName, members);
      enumNamespaceNames.add(namespace.schemaName);
    }
  }

  // Stopgap (TML-2958): flatten the schema-IR *tree* into the single `{ tables }`
  // map the PSL writer expects. The writer still walks a flat table map, so this
  // is a read-only projection — it does not reintroduce a stored flat schema.
  // The real fix is to extend the PSL writer to walk the namespace tree and emit
  // per-namespace `namespace { … }` blocks; until then `contract infer` handles a
  // single introspected namespace, and a same-named table in two schemas has no
  // unambiguous single-bucket model, so we throw rather than silently drop one.
  const tables: Record<string, SqlTableIR> = {};
  const tableNamespaceNames = new Set<string>();
  for (const namespace of namespaces) {
    const ownedEnumTypes = packOwnedEnumTypesByNamespace.get(namespace.schemaName);
    for (const [tableName, table] of Object.entries(namespace.tables)) {
      if (
        owners.has(
          coordinateKey({
            namespaceId: namespace.schemaName,
            entityKind: 'table',
            entityName: tableName,
          }),
        )
      ) {
        continue;
      }
      if (tables[tableName] !== undefined) {
        throw new Error(
          `contract infer: duplicate table name "${tableName}" across schemas is not yet supported ` +
            '(single-namespace PSL inference emits one flat bucket; multi-namespace `namespace { … }` ' +
            'output is a later slice).',
        );
      }
      if (ownedEnumTypes !== undefined) {
        for (const column of Object.values(table.columns)) {
          const owningSpaceId = ownedEnumTypes.get(column.nativeType);
          if (owningSpaceId !== undefined) {
            throw new Error(
              `contract infer: column "${tableName}"."${column.name}" is typed by native enum ` +
                `type "${column.nativeType}", which extension pack space "${owningSpaceId}" ` +
                'already describes. A cross-space enum-typed column has no authorable PSL form ' +
                "yet; describe the table in that pack's contract or retype the column before " +
                're-running contract infer.',
            );
          }
        }
      }
      tables[tableName] = new SqlTableIR(table);
      tableNamespaceNames.add(namespace.schemaName);
    }
  }

  // Namespace wrap (pinned during shaping): a `native_enum` block only lowers
  // inside an explicit `namespace { … }` block — the interpreter skips
  // extension entities in the unspecified top-level bucket — so enum-bearing
  // output wraps everything in the introspected schema's name. Enum-free
  // output stays flat and byte-identical to the prior inference.
  let wrapNamespaceName: string | undefined;
  if (enumDefinitions.size > 0) {
    const contentNamespaces = new Set([...enumNamespaceNames, ...tableNamespaceNames]);
    if (contentNamespaces.size > 1) {
      throw new Error(
        'contract infer: native enum adoption with content across multiple schemas is not yet ' +
          'supported (single-namespace PSL inference emits one `namespace { … }` block; ' +
          `multi-namespace output is a later slice). Schemas: ${[...contentNamespaces]
            .sort()
            .join(', ')}.`,
      );
    }
    wrapNamespaceName = [...contentNamespaces][0];
  }

  const {
    tables: resolvedTables,
    extraRelationsByTable,
    crossSpaceFieldNamesByTable,
  } = resolveForeignKeys(tables, owners);
  const schemaIR = new SqlSchemaIR({ tables: resolvedTables });

  // Live introspection reports an enum column's nativeType schema-qualified
  // whenever the type sits outside the connection's search_path (`format_type`
  // semantics; e.g. `auth.aal_level`), while `pg_type.typname` — the
  // definitions key — is always bare. Register the qualified spelling as an
  // alias so those columns resolve; block emission stays keyed on the bare
  // name (one block per type).
  const enumTypeNames = new Set(enumDefinitions.keys());
  if (wrapNamespaceName !== undefined) {
    for (const typeName of enumDefinitions.keys()) {
      enumTypeNames.add(`${wrapNamespaceName}.${typeName}`);
    }
  }
  const enumInfo: EnumInfo = {
    typeNames: enumTypeNames,
    definitions: enumDefinitions,
  };
  const options: PslPrinterOptions = {
    typeMap: createPostgresTypeMap(enumInfo.typeNames),
    defaultMapping: createPostgresDefaultMapping(),
    parseRawDefault,
    ...(enumDefinitions.size > 0 ? { enumInfo } : {}),
  };

  return buildPslDocumentAst(
    schemaIR,
    options,
    {
      extraRelationsByTable,
      crossSpaceFieldNamesByTable,
    },
    wrapNamespaceName,
  );
}

/**
 * Native-enum ownership index for pack subtraction, keyed by TYPE NAME
 * coordinate. A pack contract keys `entries.native_enum` by HANDLE name
 * (`AalLevel`) while introspection sees the Postgres type name (`aal_level`);
 * the entity's `typeName` field carries the mapping, so this walk indexes by
 * it rather than reusing {@link describedContractOwners}' entries-key
 * coordinates.
 *
 * Reads `entries.native_enum` directly: the kind map is carried
 * non-enumerable on `PostgresSchema.entries`, so the generic
 * `elementCoordinates` walk never yields it. Serialized pack contracts do
 * not carry `native_enum` entries at all (`PostgresContractSerializer`
 * strips them; only the derived `valueSet` survives), so this subtraction
 * currently matches in-memory described contracts only.
 */
function describedNativeEnumOwnersByTypeName(
  describedContracts: readonly SqlDescribedContractSpace[],
): ReadonlyMap<string, SqlDescribedContractSpace> {
  const owners = new Map<string, SqlDescribedContractSpace>();
  for (const entry of describedContracts) {
    for (const [namespaceId, ns] of Object.entries(entry.contract.storage.namespaces)) {
      const kindMap = ns.entries['native_enum'];
      if (!isPlainRecord(kindMap)) continue;
      for (const entity of Object.values(kindMap)) {
        if (!PostgresNativeEnum.is(entity)) continue;
        owners.set(
          coordinateKey({
            namespaceId,
            entityKind: 'native_enum',
            entityName: entity.typeName,
          }),
          entry,
        );
      }
    }
  }
  return owners;
}

export function buildPslDocumentAst(
  schemaIR: SqlSchemaIR,
  options: PslPrinterOptions,
  foreignKeyExtras: Pick<
    ForeignKeyResolution,
    'extraRelationsByTable' | 'crossSpaceFieldNamesByTable'
  >,
  namespaceName?: string,
): PslDocumentAst {
  const { typeMap, defaultMapping, parseRawDefault: rawDefaultParser } = options;
  const { extraRelationsByTable, crossSpaceFieldNamesByTable } = foreignKeyExtras;

  const modelNames = buildTopLevelNameMap(
    Object.keys(schemaIR.tables),
    toModelName,
    'model',
    'table',
  );

  const modelNameMap = new Map(
    [...modelNames].map(([tableName, result]) => [tableName, result.name]),
  );

  const { enumNameMap: bareEnumNameMap, enumBlocks } = buildNativeEnumBlocks(
    options.enumInfo?.definitions ?? new Map(),
    modelNames,
  );

  // Columns reference an enum type bare or schema-qualified (`format_type`
  // qualifies types outside the search_path); alias the qualified spelling
  // onto the same PSL name. Blocks stay keyed on the bare name.
  const enumNameMap = new Map(bareEnumNameMap);
  if (namespaceName !== undefined) {
    for (const [typeName, pslName] of bareEnumNameMap) {
      enumNameMap.set(`${namespaceName}.${typeName}`, pslName);
    }
  }

  const reservedNamedTypeNames = createReservedNamedTypeNames(modelNames, enumNameMap);

  // Cross-space entries are seeded first so a real local table of the same
  // bare name (an existing single-namespace-flat-bucket limitation, not new
  // here) always wins the merge, matching `resolveForeignKeys`'s own
  // precedence: a surviving local table is never treated as cross-space.
  const fieldNamesByTable = new Map([
    ...crossSpaceFieldNamesByTable,
    ...buildFieldNamesByTable(schemaIR.tables),
  ]);
  const { relationsByTable } = inferRelations(schemaIR.tables, modelNameMap);
  const namedTypes = seedNamedTypeRegistry(schemaIR, typeMap, enumNameMap, reservedNamedTypeNames);

  const models: PslModel[] = [];
  for (const table of Object.values(schemaIR.tables)) {
    models.push(
      buildModel(
        table,
        typeMap,
        enumNameMap,
        fieldNamesByTable,
        namedTypes,
        defaultMapping,
        rawDefaultParser,
        [
          ...(relationsByTable.get(table.name) ?? []),
          ...(extraRelationsByTable.get(table.name) ?? []),
        ],
      ),
    );
  }

  const sortedModels = topologicalSort(models, schemaIR.tables, modelNameMap);

  const namedTypeEntries = [...namedTypes.entriesByKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const types: PslTypesBlock | undefined =
    namedTypeEntries.length > 0
      ? {
          kind: 'types',
          declarations: namedTypeEntries.map(buildNamedTypeDeclaration),
          span: SYNTHETIC_SPAN,
        }
      : undefined;

  // Inferred PSL nodes will eventually be routed into per-namespace buckets
  // matching the source storage; for now everything lands in a single bucket.
  // Without a `namespaceName` that bucket is the synthesised `__unspecified__`
  // one, which the framework printer emits at top level with no
  // `namespace { … }` wrapper — preserving the existing flat introspection
  // output verbatim. With a `namespaceName` (enum-bearing output) the bucket
  // is a real named namespace, printed as an explicit block.
  const ast: PslDocumentAst = {
    kind: 'document',
    sourceId: '<sql-schema-ir>',
    namespaces: [
      makePslNamespace({
        kind: 'namespace',
        name: namespaceName ?? UNSPECIFIED_PSL_NAMESPACE_ID,
        entries: makePslNamespaceEntries(sortedModels, [], enumBlocks),
        span: SYNTHETIC_SPAN,
      }),
    ],
    ...(types ? { types } : {}),
    span: SYNTHETIC_SPAN,
  };

  return ast;
}

type NativeEnumBlockResult = {
  /** Native enum type name → PSL block name, for `pg.enum(<Name>)` field refs. */
  readonly enumNameMap: ReadonlyMap<string, string>;
  readonly enumBlocks: readonly PslExtensionBlock[];
};

/**
 * Builds one `native_enum` extension-block AST node per introspected enum
 * definition. Block names go through the shared top-level transform
 * (`toEnumName`, intra-enum collisions throw like model collisions) and are
 * then reserved against the model names — an enum whose PSL name a model
 * already claims gets a numeric suffix, with `@@map` carrying the real type
 * name. Members print as explicit `member = "value"` pairs: the member name
 * is the sanitized value (deduplicated within the block), the JSON-encoded
 * value carries the truth verbatim.
 */
function buildNativeEnumBlocks(
  definitions: ReadonlyMap<string, readonly string[]>,
  modelNames: ReadonlyMap<string, TopLevelNameResult>,
): NativeEnumBlockResult {
  const enumNames = buildTopLevelNameMap(
    [...definitions.keys()].sort(),
    toEnumName,
    'enum',
    'enum type',
  );

  const usedTopLevelNames = new Set<string>(PSL_SCALAR_TYPE_NAMES);
  for (const result of modelNames.values()) {
    usedTopLevelNames.add(result.name);
  }

  const enumNameMap = new Map<string, string>();
  const enumBlocks: PslExtensionBlock[] = [];
  for (const [typeName, result] of enumNames) {
    const name = createUniqueFieldName(result.name, usedTopLevelNames);
    usedTopLevelNames.add(name);
    enumNameMap.set(typeName, name);
    enumBlocks.push(buildNativeEnumBlock(name, typeName, definitions.get(typeName) ?? []));
  }

  return { enumNameMap, enumBlocks };
}

function buildNativeEnumBlock(
  name: string,
  typeName: string,
  values: readonly string[],
): PslExtensionBlock {
  const usedMemberNames = new Set<string>();
  const parameters: Record<string, PslExtensionBlockParamValue> = {};
  for (const value of values) {
    const memberName = createUniqueFieldName(toEnumMemberName(value), usedMemberNames);
    usedMemberNames.add(memberName);
    parameters[memberName] = { kind: 'value', raw: JSON.stringify(value), span: SYNTHETIC_SPAN };
  }

  return {
    kind: 'native_enum',
    name,
    parameters,
    blockAttributes:
      name === typeName
        ? []
        : [
            {
              name: 'map',
              args: [
                {
                  kind: 'positional',
                  value: `"${escapePslString(typeName)}"`,
                  span: SYNTHETIC_SPAN,
                },
              ],
              span: SYNTHETIC_SPAN,
            },
          ],
    span: SYNTHETIC_SPAN,
  };
}

function buildModel(
  table: SqlTableIR,
  typeMap: PslTypeMap,
  enumNameMap: ReadonlyMap<string, string>,
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  namedTypes: NamedTypeRegistry,
  defaultMapping: DefaultMappingOptions | undefined,
  rawDefaultParser: PslPrinterOptions['parseRawDefault'],
  relationFields: readonly RelationField[],
): PslModel {
  const { name: modelName, map: mapName } = toModelName(table.name);
  const fieldNameMap = fieldNamesByTable.get(table.name);

  const pkColumns = new Set(table.primaryKey?.columns ?? []);
  const isSinglePk = pkColumns.size === 1;
  const singlePkConstraintName = isSinglePk ? table.primaryKey?.name : undefined;

  const uniqueColumns = new Map<string, string | undefined>();
  for (const unique of table.uniques) {
    if (unique.columns.length === 1) {
      const [columnName = ''] = unique.columns;
      const existingConstraintName = uniqueColumns.get(columnName);
      if (!uniqueColumns.has(columnName) || (existingConstraintName === undefined && unique.name)) {
        uniqueColumns.set(columnName, unique.name);
      }
    }
  }

  const fields: PslField[] = [];
  for (const column of Object.values(table.columns)) {
    fields.push(
      buildScalarField(
        column,
        table,
        typeMap,
        enumNameMap,
        fieldNameMap,
        namedTypes,
        defaultMapping,
        rawDefaultParser,
        pkColumns,
        isSinglePk,
        singlePkConstraintName,
        uniqueColumns,
      ),
    );
  }

  const usedFieldNames = new Set(fields.map((field) => field.name));
  for (const rel of relationFields) {
    fields.push(buildRelationField(rel, table.name, fieldNamesByTable, usedFieldNames));
  }

  const modelAttributes: PslModelAttribute[] = [];

  if (table.primaryKey && table.primaryKey.columns.length > 1) {
    const pkFieldNames = table.primaryKey.columns.map((columnName) =>
      resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
    );
    modelAttributes.push(buildModelConstraintAttribute('id', pkFieldNames, table.primaryKey.name));
  }

  for (const unique of table.uniques) {
    if (unique.columns.length > 1) {
      const uniqueFieldNames = unique.columns.map((columnName) =>
        resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
      );
      modelAttributes.push(buildModelConstraintAttribute('unique', uniqueFieldNames, unique.name));
    }
  }

  for (const index of table.indexes) {
    if (!index.unique) {
      const indexFieldNames = index.columns.map((columnName) =>
        resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
      );
      modelAttributes.push(buildModelConstraintAttribute('index', indexFieldNames, index.name));
    }
  }

  if (mapName) {
    modelAttributes.push(buildMapAttribute('model', mapName));
  }

  // Surface introspection advisory: tables without a primary key cannot serve
  // as the right-hand side of a `findUnique`-style query downstream, so the
  // user should add an `@id`. This warning is part of the emitted SQL output
  // and is asserted byte-for-byte, so keep the exact wording.
  const comment = table.primaryKey
    ? undefined
    : '// WARNING: This table has no primary key in the database';

  return {
    kind: 'model',
    name: modelName,
    fields,
    attributes: modelAttributes,
    span: SYNTHETIC_SPAN,
    ...(comment !== undefined ? { comment } : {}),
  };
}

function buildScalarField(
  column: SqlColumnIR,
  table: SqlTableIR,
  typeMap: PslTypeMap,
  enumNameMap: ReadonlyMap<string, string>,
  fieldNameMap: TableColumnFieldNameMap | undefined,
  namedTypes: NamedTypeRegistry,
  defaultMapping: DefaultMappingOptions | undefined,
  rawDefaultParser: PslPrinterOptions['parseRawDefault'],
  pkColumns: ReadonlySet<string>,
  isSinglePk: boolean,
  singlePkConstraintName: string | undefined,
  uniqueColumns: ReadonlyMap<string, string | undefined>,
): PslField {
  const resolvedField = fieldNameMap?.get(column.name);
  const fieldName = resolvedField?.fieldName ?? toFieldName(column.name).name;
  const fieldMap = resolvedField?.fieldMap;

  const resolution = typeMap.resolve(column.nativeType, table.annotations);

  if ('unsupported' in resolution) {
    const attrs: PslFieldAttribute[] = [];
    if (fieldMap !== undefined) {
      attrs.push(buildMapAttribute('field', fieldMap));
    }
    return {
      kind: 'field',
      name: fieldName,
      typeName: `Unsupported("${escapePslString(resolution.nativeType)}")`,
      optional: column.nullable,
      list: column.many === true,
      attributes: attrs,
      span: SYNTHETIC_SPAN,
    };
  }

  // An enum-typed column emits the `pg.enum(<Name>)` type-constructor call —
  // the Phase-1 authoring form a `native_enum` ref field takes — not a bare
  // name substitution. The printer renders `typeConstructor` when present and
  // composes `?`/`[]` exactly like any other field type.
  let typeName = resolution.pslType;
  let typeConstructor: PslTypeConstructorCall | undefined;
  const enumPslName = enumNameMap.get(column.nativeType);
  if (enumPslName) {
    typeName = enumPslName;
    typeConstructor = {
      kind: 'typeConstructor',
      path: ['pg', 'enum'],
      args: [positionalArg(enumPslName)],
      span: SYNTHETIC_SPAN,
    };
  }
  if (resolution.nativeTypeAttribute && !enumPslName) {
    typeName = resolveNamedTypeName(namedTypes, resolution);
  }

  const attributes: PslFieldAttribute[] = [];
  const isId = isSinglePk && pkColumns.has(column.name);
  if (isId) {
    attributes.push(buildSimpleConstraintFieldAttribute('id', singlePkConstraintName));
  }

  if (column.default !== undefined) {
    const parsed = parseColumnDefault(column.default, column.nativeType, rawDefaultParser);
    if (parsed) {
      const result = mapDefault(parsed, defaultMapping);
      if ('attribute' in result) {
        attributes.push(parseDefaultAttributeString(result.attribute));
      }
      // 'comment' fallback (unrecognized raw default) is dropped — the
      // M1 legacy path emitted a `// Raw default: ...` line above the field via
      // `PrinterField.comment`. M2 drops this since it would require comment
      // nodes in the AST.
    }
  }

  if (uniqueColumns.has(column.name) && !isId) {
    const uniqueConstraintName = uniqueColumns.get(column.name);
    attributes.push(buildSimpleConstraintFieldAttribute('unique', uniqueConstraintName));
  }

  if (fieldMap !== undefined) {
    attributes.push(buildMapAttribute('field', fieldMap));
  }

  return {
    kind: 'field',
    name: fieldName,
    typeName,
    ...ifDefined('typeConstructor', typeConstructor),
    optional: column.nullable,
    list: column.many === true,
    attributes,
    span: SYNTHETIC_SPAN,
  };
}

function buildRelationField(
  rel: RelationField,
  hostTableName: string,
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  usedFieldNames: Set<string>,
): PslField {
  const fieldName = createUniqueFieldName(rel.fieldName, usedFieldNames);
  usedFieldNames.add(fieldName);

  const args: PslAttributeArgument[] = [];

  if (rel.fields && rel.references) {
    if (rel.relationName) {
      args.push(namedArg('name', `"${escapePslString(rel.relationName)}"`));
    }
    args.push(
      namedArg(
        'fields',
        `[${rel.fields
          .map((columnName) => resolveColumnFieldName(fieldNamesByTable, hostTableName, columnName))
          .join(', ')}]`,
      ),
    );
    args.push(
      namedArg(
        'references',
        `[${rel.references
          .map((columnName) =>
            resolveColumnFieldName(fieldNamesByTable, rel.referencedTableName ?? '', columnName),
          )
          .join(', ')}]`,
      ),
    );
    if (rel.onDelete) {
      args.push(namedArg('onDelete', rel.onDelete));
    }
    if (rel.onUpdate) {
      args.push(namedArg('onUpdate', rel.onUpdate));
    }
    if (rel.fkName) {
      args.push(namedArg('map', `"${escapePslString(rel.fkName)}"`));
    }
  } else if (rel.relationName) {
    args.push(namedArg('name', `"${escapePslString(rel.relationName)}"`));
  }

  const attrs: PslFieldAttribute[] =
    args.length > 0 ? [buildAttribute('field', 'relation', args)] : [];

  return {
    kind: 'field',
    name: fieldName,
    typeName: rel.typeName,
    ...ifDefined('typeNamespaceId', rel.typeNamespaceId),
    ...ifDefined('typeContractSpaceId', rel.typeContractSpaceId),
    optional: rel.optional,
    list: rel.list,
    attributes: attrs,
    span: SYNTHETIC_SPAN,
  };
}

function buildModelConstraintAttribute(
  name: 'id' | 'unique' | 'index',
  fields: readonly string[],
  constraintName?: string,
): PslModelAttribute {
  const args: PslAttributeArgument[] = [positionalArg(`[${fields.join(', ')}]`)];
  if (constraintName !== undefined) {
    args.push(namedArg('map', `"${escapePslString(constraintName)}"`));
  }
  return buildAttribute('model', name, args);
}

function buildSimpleConstraintFieldAttribute(
  name: 'id' | 'unique',
  constraintName: string | undefined,
): PslFieldAttribute {
  if (constraintName === undefined) {
    return buildAttribute('field', name, []);
  }
  return buildAttribute('field', name, [namedArg('map', `"${escapePslString(constraintName)}"`)]);
}

function parseDefaultAttributeString(attributeText: string): PslFieldAttribute {
  // Strip leading "@default(" and trailing ")" — `mapDefault` always returns one
  // top-level positional expression.
  const inner = attributeText.replace(/^@default\(/, '').replace(/\)$/, '');
  return buildAttribute('field', 'default', [positionalArg(inner)]);
}

function buildMapAttribute(target: 'model' | 'field' | 'enum', mapName: string): PslAttribute {
  return buildAttribute(target, 'map', [positionalArg(`"${escapePslString(mapName)}"`)]);
}

function buildAttribute(
  target: PslAttribute['target'],
  name: string,
  args: readonly PslAttributeArgument[],
): PslAttribute {
  return {
    kind: 'attribute',
    target,
    name,
    args,
    span: SYNTHETIC_SPAN,
  };
}

function positionalArg(value: string): PslAttributeArgument {
  return { kind: 'positional', value, span: SYNTHETIC_SPAN };
}

function namedArg(name: string, value: string): PslAttributeArgument {
  return { kind: 'named', name, value, span: SYNTHETIC_SPAN };
}

function buildNamedTypeDeclaration(entry: NamedTypeRegistryEntry): PslNamedTypeDeclaration {
  const attribute = buildAttribute(
    'namedType',
    entry.nativeTypeAttribute.name,
    (entry.nativeTypeAttribute.args ?? []).map(positionalArg),
  );
  return {
    kind: 'namedType',
    name: entry.name,
    baseType: entry.baseType,
    attributes: [attribute],
    span: SYNTHETIC_SPAN,
  };
}

function escapePslString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Resolves a `SqlColumnIR.default` value into a normalized {@link ColumnDefault}.
 *
 * `SqlSchemaIR` types the column default as `string` (a raw database default
 * expression). Some legacy fixtures and tests still pass already-normalized
 * `ColumnDefault` objects in the same slot, so we accept either shape
 * defensively at runtime.
 */
function parseColumnDefault(
  value: unknown,
  nativeType: string | undefined,
  rawDefaultParser: PslPrinterOptions['parseRawDefault'],
): ColumnDefault | undefined {
  if (typeof value === 'string') {
    return rawDefaultParser ? rawDefaultParser(value, nativeType) : undefined;
  }
  if (value !== null && typeof value === 'object' && 'kind' in (value as Record<string, unknown>)) {
    return value as ColumnDefault;
  }
  return undefined;
}

function buildFieldNamesByTable(
  tables: Record<string, SqlTableIR>,
): ReadonlyMap<string, TableColumnFieldNameMap> {
  const fieldNamesByTable = new Map<string, TableColumnFieldNameMap>();

  for (const table of Object.values(tables)) {
    const columns = Object.values(table.columns).map((column, index) => {
      const { name, map } = toFieldName(column.name);
      return {
        columnName: column.name,
        desiredFieldName: name,
        fieldMap: map,
        index,
      };
    });

    const assignmentOrder = [...columns].sort((left, right) => {
      const mapComparison =
        Number(left.fieldMap !== undefined) - Number(right.fieldMap !== undefined);
      if (mapComparison !== 0) {
        return mapComparison;
      }
      return left.index - right.index;
    });

    const usedFieldNames = new Set<string>();
    const tableFieldNames = new Map<string, ResolvedColumnFieldName>();

    for (const column of assignmentOrder) {
      const fieldName = createUniqueFieldName(column.desiredFieldName, usedFieldNames);
      usedFieldNames.add(fieldName);
      tableFieldNames.set(column.columnName, {
        fieldName,
        fieldMap: column.fieldMap,
      });
    }

    fieldNamesByTable.set(table.name, tableFieldNames);
  }

  return fieldNamesByTable;
}

function resolveColumnFieldName(
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  tableName: string,
  columnName: string,
): string {
  return (
    fieldNamesByTable.get(tableName)?.get(columnName)?.fieldName ?? toFieldName(columnName).name
  );
}

function createUniqueFieldName(desiredName: string, usedFieldNames: ReadonlySet<string>): string {
  if (!usedFieldNames.has(desiredName)) {
    return desiredName;
  }

  let counter = 2;
  while (usedFieldNames.has(`${desiredName}${counter}`)) {
    counter++;
  }
  return `${desiredName}${counter}`;
}

function buildTopLevelNameMap(
  sources: Iterable<string>,
  normalize: (source: string) => TopLevelNameResult,
  kind: 'model' | 'enum',
  sourceKind: 'table' | 'enum type',
): Map<string, TopLevelNameResult> {
  const results = new Map<string, TopLevelNameResult>();
  const normalizedToSources = new Map<string, string[]>();

  for (const source of sources) {
    const normalized = normalize(source);
    results.set(source, normalized);
    normalizedToSources.set(normalized.name, [
      ...(normalizedToSources.get(normalized.name) ?? []),
      source,
    ]);
  }

  const duplicates = [...normalizedToSources.entries()].filter(
    ([, conflictingSources]) => conflictingSources.length > 1,
  );
  if (duplicates.length > 0) {
    const details = duplicates.map(
      ([normalizedName, conflictingSources]) =>
        `- ${kind} "${normalizedName}" from ${sourceKind}s ${conflictingSources
          .map((source) => `"${source}"`)
          .join(', ')}`,
    );
    throw new Error(`PSL ${kind} name collisions detected:\n${details.join('\n')}`);
  }

  return results;
}

function createReservedNamedTypeNames(
  modelNames: ReadonlyMap<string, TopLevelNameResult>,
  enumNameMap: ReadonlyMap<string, string>,
): Set<string> {
  const reservedNames = new Set<string>(PSL_SCALAR_TYPE_NAMES);

  for (const result of modelNames.values()) {
    reservedNames.add(result.name);
  }
  for (const enumPslName of enumNameMap.values()) {
    reservedNames.add(enumPslName);
  }

  return reservedNames;
}

function seedNamedTypeRegistry(
  schemaIR: SqlSchemaIR,
  typeMap: PslTypeMap,
  enumNameMap: ReadonlyMap<string, string>,
  reservedNames: ReadonlySet<string>,
): NamedTypeRegistry {
  type Seed = {
    readonly baseType: string;
    readonly desiredName: string;
    readonly nativeTypeAttribute: PslNativeTypeAttribute;
  };

  const seeds = new Map<string, Seed>();

  for (const tableName of Object.keys(schemaIR.tables).sort()) {
    const table = schemaIR.tables[tableName];
    if (!table) {
      continue;
    }

    for (const columnName of Object.keys(table.columns).sort()) {
      const column = table.columns[columnName];
      if (!column) {
        continue;
      }

      const resolution = typeMap.resolve(column.nativeType, table.annotations);
      if (
        'unsupported' in resolution ||
        enumNameMap.has(column.nativeType) ||
        !resolution.nativeTypeAttribute
      ) {
        continue;
      }

      const signatureKey = createNamedTypeSignatureKey(resolution);
      if (!seeds.has(signatureKey)) {
        seeds.set(signatureKey, {
          baseType: resolution.pslType,
          desiredName: toNamedTypeName(column.name),
          nativeTypeAttribute: resolution.nativeTypeAttribute,
        });
      }
    }
  }

  const registry: NamedTypeRegistry = {
    entriesByKey: new Map<string, NamedTypeRegistryEntry>(),
    usedNames: new Set<string>(reservedNames),
  };

  const sortedSeeds = [...seeds.entries()].sort((left, right) => {
    const desiredNameComparison = left[1].desiredName.localeCompare(right[1].desiredName);
    if (desiredNameComparison !== 0) {
      return desiredNameComparison;
    }
    return left[0].localeCompare(right[0]);
  });

  for (const [signatureKey, seed] of sortedSeeds) {
    const name = createUniqueFieldName(seed.desiredName, registry.usedNames);
    registry.entriesByKey.set(signatureKey, {
      name,
      baseType: seed.baseType,
      nativeTypeAttribute: seed.nativeTypeAttribute,
    });
    registry.usedNames.add(name);
  }

  return registry;
}

function resolveNamedTypeName(
  registry: NamedTypeRegistry,
  resolution: {
    readonly pslType: string;
    readonly nativeType: string;
    readonly typeParams?: Record<string, unknown>;
    readonly nativeTypeAttribute?: PslNativeTypeAttribute;
  },
): string {
  const key = createNamedTypeSignatureKey(resolution);
  const existing = registry.entriesByKey.get(key);
  if (existing) {
    return existing.name;
  }

  throw new Error(`Named type registry was not seeded for native type "${resolution.nativeType}"`);
}

function createNamedTypeSignatureKey(resolution: {
  readonly pslType: string;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
  readonly nativeTypeAttribute?: PslNativeTypeAttribute;
}): string {
  return JSON.stringify({
    baseType: resolution.pslType,
    nativeTypeAttribute: resolution.nativeTypeAttribute
      ? {
          name: resolution.nativeTypeAttribute.name,
          args: resolution.nativeTypeAttribute.args ?? null,
        }
      : null,
  });
}

function topologicalSort(
  models: PslModel[],
  tables: Record<string, SqlTableIR>,
  modelNameMap: ReadonlyMap<string, string>,
): PslModel[] {
  const modelByName = new Map<string, PslModel>();
  for (const model of models) {
    modelByName.set(model.name, model);
  }

  const deps = new Map<string, Set<string>>();
  const tableToModel = new Map<string, string>();
  for (const tableName of Object.keys(tables)) {
    const modelName = modelNameMap.get(tableName) as string;
    tableToModel.set(tableName, modelName);
    deps.set(modelName, new Set());
  }

  for (const [tableName, table] of Object.entries(tables)) {
    const modelName = tableToModel.get(tableName) as string;
    for (const fk of table.foreignKeys) {
      const refModelName = tableToModel.get(fk.referencedTable);
      if (refModelName && refModelName !== modelName) {
        (deps.get(modelName) as Set<string>).add(refModelName);
      }
    }
  }

  const result: PslModel[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const sortedNames = [...deps.keys()].sort();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;
    visiting.add(name);

    const sortedDeps = [...(deps.get(name) as Set<string>)].sort();
    for (const dep of sortedDeps) {
      visit(dep);
    }

    visiting.delete(name);
    visited.add(name);
    result.push(modelByName.get(name) as PslModel);
  }

  for (const name of sortedNames) {
    visit(name);
  }

  return result;
}
