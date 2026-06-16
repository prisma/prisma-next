import type {
  Contract,
  ContractField,
  ContractModel,
  ContractModelBase,
  JsonValue,
} from '@prisma-next/contract/types';
import {
  serializeNamespaceId,
  serializeObjectKey,
  serializeValue,
} from '@prisma-next/emitter/domain-type-generation';
import type {
  GenerateContractTypesOptions,
  ResolvedFieldTypeStrings,
  ValidationContext,
} from '@prisma-next/framework-components/emission';
import {
  entityAt,
  type Namespace,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import type {
  SqlModelStorage,
  SqlStorage,
  StorageTable,
  StorageTypeInstance,
  StorageValueSet,
} from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';

function serializeTypeParamsLiteral(params: Record<string, unknown> | undefined): string {
  if (!params || Object.keys(params).length === 0) {
    return 'Record<string, never>';
  }

  const entries: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    entries.push(`readonly ${serializeObjectKey(key)}: ${serializeValue(value)}`);
  }

  return `{ ${entries.join('; ')} }`;
}

export const sqlEmission = {
  id: 'sql',

  validateTypes(contract: Contract, _ctx: ValidationContext): void {
    const storage = contract.storage as unknown as SqlStorage | undefined;
    if (!storage?.namespaces) {
      return;
    }

    const typeIdRegex = /^([^/]+)\/([^@]+)@(\d+)$/;

    for (const ns of Object.values(storage.namespaces)) {
      for (const [tableName, table] of Object.entries(ns.entries.table ?? {})) {
        for (const [colName, colUnknown] of Object.entries(table.columns)) {
          const col = colUnknown as { codecId?: string };
          const codecId = col.codecId;
          if (!codecId) {
            throw new Error(`Column "${colName}" in table "${tableName}" is missing codecId`);
          }

          const match = codecId.match(typeIdRegex);
          if (!match?.[1]) {
            throw new Error(
              `Column "${colName}" in table "${tableName}" has invalid codec ID format "${codecId}". Expected format: ns/name@version`,
            );
          }
        }
      }
    }
  },

  validateStructure(contract: Contract): void {
    if (contract.targetFamily !== 'sql') {
      throw new Error(`Expected targetFamily "sql", got "${contract.targetFamily}"`);
    }

    const storage = contract.storage as unknown as SqlStorage | undefined;
    if (!storage?.namespaces) {
      throw new Error('SQL contract must have storage.namespaces');
    }

    const tableNamesSeenAcrossNamespaces = new Map<string, string>();
    for (const [nsId, ns] of Object.entries(storage.namespaces)) {
      for (const tableName of Object.keys(ns.entries.table ?? {})) {
        const existingNs = tableNamesSeenAcrossNamespaces.get(tableName);
        if (existingNs !== undefined && existingNs !== nsId) {
          throw new Error(
            `Duplicate table name "${tableName}" in namespaces "${existingNs}" and "${nsId}"`,
          );
        }
        tableNamesSeenAcrossNamespaces.set(tableName, nsId);
      }
    }

    const tableNames = new Set<string>();
    for (const ns of Object.values(storage.namespaces)) {
      for (const t of Object.keys(ns.entries.table ?? {})) {
        tableNames.add(t);
      }
    }

    for (const [namespaceId, domainNs] of Object.entries(contract.domain.namespaces)) {
      const models = domainNs.models as Record<string, ContractModel<SqlModelStorage>>;
      for (const [modelName, model] of Object.entries(models)) {
        const qualifiedName = `${namespaceId}:${modelName}`;
        if (!model.storage?.table) {
          throw new Error(`Model "${qualifiedName}" is missing storage.table`);
        }
        if (!model.storage.namespaceId) {
          throw new Error(`Model "${qualifiedName}" is missing storage.namespaceId`);
        }
        if (model.storage.namespaceId !== namespaceId) {
          throw new Error(
            `Model "${qualifiedName}" storage.namespaceId "${model.storage.namespaceId}" does not match domain namespace "${namespaceId}"`,
          );
        }

        const tableName = model.storage.table;
        const table = entityAt<StorageTable>(storage, {
          namespaceId,
          entityKind: 'table',
          entityName: tableName,
        });
        if (!table) {
          throw new Error(
            `Model "${qualifiedName}" references non-existent table "${namespaceId}.${tableName}"`,
          );
        }
        const columnNames = new Set(Object.keys(table.columns));
        const storageFields = model.storage.fields;
        if (!storageFields || Object.keys(storageFields).length === 0) {
          throw new Error(`Model "${qualifiedName}" is missing storage.fields`);
        }

        for (const [fieldName, field] of Object.entries(storageFields)) {
          if (!field.column) {
            throw new Error(
              `Model "${qualifiedName}" field "${fieldName}" is missing column property`,
            );
          }

          if (!columnNames.has(field.column)) {
            throw new Error(
              `Model "${qualifiedName}" field "${fieldName}" references non-existent column "${field.column}" in table "${tableName}"`,
            );
          }
        }

        if (!model.relations || typeof model.relations !== 'object') {
          throw new Error(
            `Model "${qualifiedName}" is missing required field "relations" (must be an object)`,
          );
        }
      }
    }

    for (const ns of Object.values(storage.namespaces)) {
      for (const [tableName, table] of Object.entries(ns.entries.table ?? {})) {
        const columnNames = new Set(Object.keys(table.columns));

        if (!Array.isArray(table.uniques)) {
          throw new Error(
            `Table "${tableName}" is missing required field "uniques" (must be an array)`,
          );
        }
        if (!Array.isArray(table.indexes)) {
          throw new Error(
            `Table "${tableName}" is missing required field "indexes" (must be an array)`,
          );
        }
        if (!Array.isArray(table.foreignKeys)) {
          throw new Error(
            `Table "${tableName}" is missing required field "foreignKeys" (must be an array)`,
          );
        }

        if (table.primaryKey) {
          for (const colName of table.primaryKey.columns) {
            if (!columnNames.has(colName)) {
              throw new Error(
                `Table "${tableName}" primaryKey references non-existent column "${colName}"`,
              );
            }
          }
        }

        for (const unique of table.uniques) {
          for (const colName of unique.columns) {
            if (!columnNames.has(colName)) {
              throw new Error(
                `Table "${tableName}" unique constraint references non-existent column "${colName}"`,
              );
            }
          }
        }

        for (const index of table.indexes) {
          for (const colName of index.columns) {
            if (!columnNames.has(colName)) {
              throw new Error(
                `Table "${tableName}" index references non-existent column "${colName}"`,
              );
            }
          }
        }

        for (const fk of table.foreignKeys) {
          for (const colName of fk.source.columns) {
            if (!columnNames.has(colName)) {
              throw new Error(
                `Table "${tableName}" foreignKey references non-existent column "${colName}"`,
              );
            }
          }

          const referencedTable = entityAt<StorageTable>(storage, {
            namespaceId: fk.target.namespaceId,
            entityKind: 'table',
            entityName: fk.target.tableName,
          });
          if (!referencedTable) {
            throw new Error(
              `Table "${tableName}" foreignKey references non-existent table "${fk.target.tableName}" in namespace "${fk.target.namespaceId}"`,
            );
          }

          const referencedColumnNames = new Set(Object.keys(referencedTable.columns));
          for (const colName of fk.target.columns) {
            if (!referencedColumnNames.has(colName)) {
              throw new Error(
                `Table "${tableName}" foreignKey references non-existent column "${colName}" in table "${fk.target.tableName}"`,
              );
            }
          }

          if (fk.source.columns.length !== fk.target.columns.length) {
            throw new Error(
              `Table "${tableName}" foreignKey column count (${fk.source.columns.length}) does not match referenced column count (${fk.target.columns.length})`,
            );
          }
        }
      }
    }
  },

  generateStorageType(contract: Contract, storageHashTypeName: string): string {
    const storage = contract.storage as unknown as SqlStorage;
    const namespacesType = generateStorageNamespacesType(storage.namespaces);
    const docTypes = generateDocumentScopedStorageTypesType(storage.types);
    const typesClause = docTypes === undefined ? '' : `; readonly types: ${docTypes}`;
    return `{ readonly namespaces: ${namespacesType}${typesClause}; readonly storageHash: ${storageHashTypeName} }`;
  },

  generateModelStorageType(_modelName: string, model: ContractModelBase): string {
    const sqlModel = model as ContractModel<SqlModelStorage>;
    const tableName = sqlModel.storage.table;
    const storageFields = sqlModel.storage.fields;

    const storageParts = [
      `readonly table: ${serializeValue(tableName)}`,
      `readonly namespaceId: ${serializeValue(sqlModel.storage.namespaceId)}`,
    ];
    if (Object.keys(storageFields).length > 0) {
      const fieldParts: string[] = [];
      for (const [fieldName, field] of Object.entries(storageFields)) {
        fieldParts.push(
          `readonly ${serializeObjectKey(fieldName)}: { readonly column: ${serializeValue(field.column)} }`,
        );
      }
      storageParts.push(`readonly fields: { ${fieldParts.join('; ')} }`);
    }

    return `{ ${storageParts.join('; ')} }`;
  },

  resolveFieldTypeParams(
    _modelName: string,
    fieldName: string,
    model: ContractModelBase,
    contract: Contract,
  ): Record<string, unknown> | undefined {
    const sqlModel = model as ContractModel<SqlModelStorage>;
    const storageField = sqlModel.storage?.fields?.[fieldName];
    if (!storageField) return undefined;

    const storage = contract.storage as unknown as SqlStorage | undefined;
    if (!storage) return undefined;

    const tableName = sqlModel.storage.table;
    const storageNamespaceId = sqlModel.storage.namespaceId;
    if (!storageNamespaceId) return undefined;

    const table = entityAt<StorageTable>(storage, {
      namespaceId: storageNamespaceId,
      entityKind: 'table',
      entityName: tableName,
    });
    if (!table) return undefined;

    const column = table.columns[storageField.column];
    if (!column) return undefined;

    if (column.typeRef) {
      const typeInstance = storage.types?.[column.typeRef];
      if (typeInstance === undefined) return undefined;
      const codecShape = typeInstance as Partial<StorageTypeInstance>;
      return codecShape.typeParams;
    }
    return column.typeParams;
  },

  resolveFieldType(
    _modelName: string,
    fieldName: string,
    field: ContractField,
    model: ContractModelBase,
    contract: Contract,
  ): ResolvedFieldTypeStrings | undefined {
    const sqlModel = blindCast<
      ContractModel<SqlModelStorage>,
      'same pattern as resolveFieldTypeParams above'
    >(model);
    const storageField = sqlModel.storage?.fields?.[fieldName];
    if (!storageField) return undefined;

    const storage = blindCast<
      SqlStorage | undefined,
      'contract.storage is SqlStorage for sql family'
    >(contract.storage);
    if (!storage) return undefined;

    const tableName = sqlModel.storage.table;
    const storageNamespaceId = sqlModel.storage.namespaceId;
    if (!storageNamespaceId) return undefined;

    const table = entityAt<StorageTable>(storage, {
      namespaceId: storageNamespaceId,
      entityKind: 'table',
      entityName: tableName,
    });
    if (!table) return undefined;

    const column = table.columns[storageField.column];
    if (!column?.valueSet) return undefined;

    const valueSet = entityAt<StorageValueSet>(storage, {
      namespaceId: column.valueSet.namespaceId,
      entityKind: column.valueSet.entityKind,
      entityName: column.valueSet.entityName,
    });
    if (!valueSet) return undefined;

    const union = renderValueSetUnion(valueSet.values, field.nullable);
    if (!union) return undefined;

    return { output: union, input: union };
  },

  getExtraTypeExports(contract: Contract): string | undefined {
    const storage = blindCast<
      SqlStorage | undefined,
      'contract.storage is SqlStorage for sql family'
    >(contract.storage);
    if (!storage?.namespaces) return undefined;
    const storageColumnTypes = generateStorageColumnTypesMap(storage);
    return `export type StorageColumnTypes = ${storageColumnTypes};`;
  },

  getFamilyImports(): string[] {
    return [
      'import type {',
      '  ContractWithTypeMaps,',
      '  TypeMaps as TypeMapsType,',
      "} from '@prisma-next/sql-contract/types';",
    ];
  },

  getFamilyTypeAliases(options?: GenerateContractTypesOptions): string {
    const queryOperationTypeImports = options?.queryOperationTypeImports ?? [];
    const queryOperationAliases = queryOperationTypeImports
      .filter((imp) => imp.named === 'QueryOperationTypes')
      .map((imp) => `${imp.alias}<CodecTypes>`);
    const queryOperationTypes =
      queryOperationAliases.length > 0
        ? queryOperationAliases.join(' & ')
        : 'Record<string, never>';

    return [
      'export type LaneCodecTypes = CodecTypes;',
      `export type QueryOperationTypes = ${queryOperationTypes};`,
      'type DefaultLiteralValue<CodecId extends string, _Encoded> =',
      '  CodecId extends keyof CodecTypes',
      "    ? CodecTypes[CodecId]['output']",
      '    : _Encoded;',
    ].join('\n');
  },

  getTypeMapsExpression(): string {
    return 'TypeMapsType<CodecTypes, QueryOperationTypes, FieldOutputTypes, FieldInputTypes>';
  },

  getContractWrapper(contractBaseName: string, typeMapsName: string): string {
    return [
      `export type Contract = ContractWithTypeMaps<${contractBaseName}, ${typeMapsName}>;`,
      '',
      "export type Namespaces = Contract['storage']['namespaces'];",
    ].join('\n');
  },
} as const;

function renderValueSetLiteral(value: JsonValue): string | undefined {
  if (typeof value === 'string') return serializeValue(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function renderValueSetUnion(values: readonly JsonValue[], nullable: boolean): string | undefined {
  if (values.length === 0) return undefined;
  const literals: string[] = [];
  for (const v of values) {
    const lit = renderValueSetLiteral(v);
    if (lit === undefined) return undefined;
    literals.push(lit);
  }
  const union = literals.join(' | ');
  return nullable ? `${union} | null` : union;
}

function generateStorageColumnTypesMap(storage: SqlStorage): string {
  const namespaceEntries = Object.entries(storage.namespaces ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (namespaceEntries.length === 0) return 'Record<string, never>';

  const nsParts: string[] = [];
  for (const [nsId, ns] of namespaceEntries) {
    const tables = blindCast<
      Readonly<Record<string, StorageTable>>,
      'same pattern as generateTablesMapType below'
    >(ns.entries.table ?? {});
    const tableEntries = Object.entries(tables).sort(([a], [b]) => a.localeCompare(b));
    const tableParts: string[] = [];

    for (const [tableName, table] of tableEntries) {
      const colEntries = Object.entries(table.columns).sort(([a], [b]) => a.localeCompare(b));
      const colParts: string[] = [];

      for (const [colName, col] of colEntries) {
        let colType: string;

        if (col.valueSet) {
          const valueSet = entityAt<StorageValueSet>(storage, {
            namespaceId: col.valueSet.namespaceId,
            entityKind: col.valueSet.entityKind,
            entityName: col.valueSet.entityName,
          });
          const union = valueSet ? renderValueSetUnion(valueSet.values, col.nullable) : undefined;
          if (union !== undefined) {
            colType = union;
          } else {
            const codecAccessor = `CodecTypes[${serializeValue(col.codecId)}]`;
            colType = col.nullable
              ? `${codecAccessor}['output'] | null`
              : `${codecAccessor}['output']`;
          }
        } else {
          const codecAccessor = `CodecTypes[${serializeValue(col.codecId)}]`;
          colType = col.nullable
            ? `${codecAccessor}['output'] | null`
            : `${codecAccessor}['output']`;
        }

        colParts.push(`readonly ${serializeObjectKey(colName)}: ${colType}`);
      }

      const colMap = colParts.length > 0 ? `{ ${colParts.join('; ')} }` : '{}';
      tableParts.push(`readonly ${serializeObjectKey(tableName)}: ${colMap}`);
    }

    const tableMap = tableParts.length > 0 ? `{ ${tableParts.join('; ')} }` : '{}';
    nsParts.push(`readonly ${serializeObjectKey(nsId)}: ${tableMap}`);
  }

  return `{ ${nsParts.join('; ')} }`;
}

function generateDocumentScopedStorageTypesType(types: SqlStorage['types']): string | undefined {
  if (!types || Object.keys(types).length === 0) {
    return undefined;
  }

  const typeEntries: string[] = [];
  for (const [typeName, typeInstance] of Object.entries(types)) {
    const codecInstanceShape = typeInstance as Partial<StorageTypeInstance>;
    if (
      typeof codecInstanceShape.codecId !== 'string' ||
      typeof codecInstanceShape.nativeType !== 'string'
    ) {
      throw new Error(
        `Unknown storage type kind for "${typeName}" in document-scoped storage.types; expected a codec-instance triple.`,
      );
    }
    const codecId = serializeValue(codecInstanceShape.codecId);
    const nativeType = serializeValue(codecInstanceShape.nativeType);
    const typeParamsStr = serializeTypeParamsLiteral(codecInstanceShape.typeParams);
    typeEntries.push(
      `readonly ${typeName}: { readonly kind: 'codec-instance'; readonly codecId: ${codecId}; readonly nativeType: ${nativeType}; readonly typeParams: ${typeParamsStr} }`,
    );
  }

  return `{ ${typeEntries.join('; ')} }`;
}

function generateNamespaceValueSetType(
  valueSet: Readonly<Record<string, StorageValueSet>>,
): string {
  if (Object.keys(valueSet).length === 0) {
    return 'Record<string, never>';
  }
  const entries: string[] = [];
  for (const [name, vs] of Object.entries(valueSet)) {
    const valuesLiteral = vs.values.map((v) => serializeValue(v)).join(', ');
    entries.push(
      `readonly ${serializeObjectKey(name)}: { readonly kind: 'valueSet'; readonly values: readonly [${valuesLiteral}] }`,
    );
  }
  return `{ ${entries.join('; ')} }`;
}

const SQL_NAMESPACE_KIND_FALLBACK = 'sql-namespace' as const;

function namespaceSerializedKind(ns: Namespace): string {
  const kind = ns.kind;
  if (kind === 'schema') {
    const id = ns.id;
    const lit = id === UNBOUND_NAMESPACE_ID ? 'postgres-unbound-schema' : 'postgres-schema';
    return `readonly kind: '${lit}'`;
  }
  if (typeof kind === 'string') {
    return `readonly kind: ${serializeValue(kind)}`;
  }
  // Plain-literal namespaces built via the contract-ts DSL bypass the
  // class-level `Object.defineProperty(this, 'kind', { value, enumerable: false })`
  // path, so `ns.kind` is missing on the runtime object. Surfacing the
  // framework-default kind here keeps the emitted `.d.ts` literal
  // structurally assignable to `Namespace`, which now requires `kind`.
  return `readonly kind: '${SQL_NAMESPACE_KIND_FALLBACK}'`;
}

function generateTableLiteralType(table: StorageTable): string {
  const columns: string[] = [];
  for (const [colName, col] of Object.entries(table.columns)) {
    const nullable = col.nullable ? 'true' : 'false';
    const nativeType = serializeValue(col.nativeType);
    const codecId = serializeValue(col.codecId);
    const defaultSpec = col.default
      ? col.default.kind === 'literal'
        ? `; readonly default: { readonly kind: 'literal'; readonly value: DefaultLiteralValue<${codecId}, ${serializeValue(
            col.default.value,
          )}> }`
        : `; readonly default: { readonly kind: 'function'; readonly expression: ${serializeValue(
            col.default.expression,
          )} }`
      : '';
    const typeParamsSpec =
      col.typeParams && Object.keys(col.typeParams).length > 0
        ? `; readonly typeParams: ${serializeTypeParamsLiteral(col.typeParams)}`
        : '';
    const typeRefSpec = col.typeRef ? `; readonly typeRef: ${serializeValue(col.typeRef)}` : '';
    columns.push(
      `readonly ${colName}: { readonly nativeType: ${nativeType}; readonly codecId: ${codecId}; readonly nullable: ${nullable}${defaultSpec}${typeParamsSpec}${typeRefSpec} }`,
    );
  }

  const tableParts: string[] = [`columns: { ${columns.join('; ')} }`];

  if (table.primaryKey) {
    const pkCols = table.primaryKey.columns.map((c) => serializeValue(c)).join(', ');
    const pkName = table.primaryKey.name
      ? `; readonly name: ${serializeValue(table.primaryKey.name)}`
      : '';
    tableParts.push(`primaryKey: { readonly columns: readonly [${pkCols}]${pkName} }`);
  }

  const uniques = table.uniques
    .map((u) => {
      const cols = u.columns.map((c: string) => serializeValue(c)).join(', ');
      const name = u.name ? `; readonly name: ${serializeValue(u.name)}` : '';
      return `{ readonly columns: readonly [${cols}]${name} }`;
    })
    .join(', ');
  tableParts.push(`uniques: readonly [${uniques}]`);

  const indexes = table.indexes
    .map((i) => {
      const cols = i.columns.map((c: string) => serializeValue(c)).join(', ');
      const name = i.name !== undefined ? `; readonly name: ${serializeValue(i.name)}` : '';
      const indexType = i.type !== undefined ? `; readonly type: ${serializeValue(i.type)}` : '';
      const indexOptions =
        i.options !== undefined ? `; readonly options: ${serializeValue(i.options)}` : '';
      return `{ readonly columns: readonly [${cols}]${name}${indexType}${indexOptions} }`;
    })
    .join(', ');
  tableParts.push(`indexes: readonly [${indexes}]`);

  const fks = table.foreignKeys
    .map((fk) => {
      const srcCols = fk.source.columns.map((c: string) => serializeValue(c)).join(', ');
      const tgtCols = fk.target.columns.map((c: string) => serializeValue(c)).join(', ');
      const name = fk.name ? `; readonly name: ${serializeValue(fk.name)}` : '';
      const srcRef = `{ readonly namespaceId: ${serializeNamespaceId(String(fk.source.namespaceId))}; readonly tableName: ${serializeValue(fk.source.tableName)}; readonly columns: readonly [${srcCols}] }`;
      const tgtRef = `{ readonly namespaceId: ${serializeNamespaceId(String(fk.target.namespaceId))}; readonly tableName: ${serializeValue(fk.target.tableName)}; readonly columns: readonly [${tgtCols}] }`;
      return `{ readonly source: ${srcRef}; readonly target: ${tgtRef}${name}; readonly constraint: ${fk.constraint}; readonly index: ${fk.index} }`;
    })
    .join(', ');
  tableParts.push(`foreignKeys: readonly [${fks}]`);

  return `{ ${tableParts.join('; ')} }`;
}

function generateTablesMapType(tables: Readonly<Record<string, StorageTable>>): string {
  const tableEntries: string[] = [];
  for (const [tableName, table] of Object.entries(tables).sort(([a], [b]) => a.localeCompare(b))) {
    tableEntries.push(`readonly ${tableName}: ${generateTableLiteralType(table)}`);
  }
  if (tableEntries.length === 0) {
    // Empty namespaces must emit `{}` (whose `keyof` is `never`), not
    // `Record<string, never>` (whose `keyof` is `string`). The latter
    // collapses `Db<C>` to a string-indexed shape and erases literal
    // table-name inference at every consumer site that walks all
    // namespaces (e.g. `db.sql.<tableName>`).
    return '{}';
  }
  return `{ ${tableEntries.join('; ')} }`;
}

function generateStorageNamespacesType(namespaces: SqlStorage['namespaces']): string {
  const entries = Object.entries(namespaces ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return 'Record<string, never>';
  }
  const parts: string[] = [];
  for (const [name, ns] of entries) {
    const kindSuffix = `; ${namespaceSerializedKind(ns)}`;
    const tablesType = generateTablesMapType(
      (ns.entries.table ?? {}) as Readonly<Record<string, StorageTable>>,
    );
    const valueSetSlot = ns.entries.valueSet;
    const entriesParts = [`readonly table: ${tablesType}`];
    if (valueSetSlot !== undefined && Object.keys(valueSetSlot).length > 0) {
      entriesParts.push(`readonly valueSet: ${generateNamespaceValueSetType(valueSetSlot)}`);
    }
    const entriesType = `{ ${entriesParts.join('; ')} }`;
    parts.push(
      `readonly ${serializeObjectKey(name)}: { readonly id: ${serializeValue(ns.id)}${kindSuffix}; readonly entries: ${entriesType} }`,
    );
  }
  return `{ ${parts.join('; ')} }`;
}
