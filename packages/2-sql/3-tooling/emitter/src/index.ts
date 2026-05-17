import type { Contract, ContractModel } from '@prisma-next/contract/types';
import { serializeObjectKey, serializeValue } from '@prisma-next/emitter/domain-type-generation';
import type {
  GenerateContractTypesOptions,
  ValidationContext,
} from '@prisma-next/framework-components/emission';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  findTableByName,
  findTypeByName,
  isPostgresEnumStorageEntry,
  iterateTablesWithCoords,
  iterateTypesWithCoords,
  type PostgresEnumStorageEntry,
  type SqlModelStorage,
  type SqlStorage,
  type StorageTable,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { assertDefined } from '@prisma-next/utils/assertions';

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
    if (!storage?.tables) {
      return;
    }

    const typeIdRegex = /^([^/]+)\/([^@]+)@(\d+)$/;

    for (const { name: tableName, table } of iterateTablesWithCoords(storage)) {
      for (const [colName, col] of Object.entries(table.columns)) {
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
  },

  validateStructure(contract: Contract): void {
    if (contract.targetFamily !== 'sql') {
      throw new Error(`Expected targetFamily "sql", got "${contract.targetFamily}"`);
    }

    const storage = contract.storage as unknown as SqlStorage | undefined;
    if (!storage?.tables) {
      throw new Error('SQL contract must have storage.tables');
    }

    const models = contract.models as Record<string, ContractModel<SqlModelStorage>>;
    const tableNames = new Set<string>();
    for (const { name } of iterateTablesWithCoords(storage)) {
      tableNames.add(name);
    }

    if (models) {
      for (const [modelName, model] of Object.entries(models)) {
        if (!model.storage?.table) {
          throw new Error(`Model "${modelName}" is missing storage.table`);
        }

        const tableName = model.storage.table;
        if (!tableNames.has(tableName)) {
          throw new Error(`Model "${modelName}" references non-existent table "${tableName}"`);
        }

        const table: StorageTable | undefined = findTableByName(storage, tableName);
        assertDefined(table, `Model "${modelName}" references non-existent table "${tableName}"`);

        const columnNames = new Set(Object.keys(table.columns));
        const storageFields = model.storage.fields;
        if (!storageFields || Object.keys(storageFields).length === 0) {
          throw new Error(`Model "${modelName}" is missing storage.fields`);
        }

        for (const [fieldName, field] of Object.entries(storageFields)) {
          if (!field.column) {
            throw new Error(`Model "${modelName}" field "${fieldName}" is missing column property`);
          }

          if (!columnNames.has(field.column)) {
            throw new Error(
              `Model "${modelName}" field "${fieldName}" references non-existent column "${field.column}" in table "${tableName}"`,
            );
          }
        }

        if (!model.relations || typeof model.relations !== 'object') {
          throw new Error(
            `Model "${modelName}" is missing required field "relations" (must be an object)`,
          );
        }
      }
    }

    for (const { name: tableName, table } of iterateTablesWithCoords(storage)) {
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

        if (!tableNames.has(fk.target.table)) {
          throw new Error(
            `Table "${tableName}" foreignKey references non-existent table "${fk.target.table}"`,
          );
        }

        const referencedTable: StorageTable | undefined = findTableByName(storage, fk.target.table);
        assertDefined(
          referencedTable,
          `Table "${tableName}" foreignKey references non-existent table "${fk.target.table}"`,
        );

        const referencedColumnNames = new Set(Object.keys(referencedTable.columns));
        for (const colName of fk.target.columns) {
          if (!referencedColumnNames.has(colName)) {
            throw new Error(
              `Table "${tableName}" foreignKey references non-existent column "${colName}" in table "${fk.target.table}"`,
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
  },

  generateStorageType(contract: Contract, storageHashTypeName: string): string {
    const storage = contract.storage as unknown as SqlStorage;
    const tablesType = generateTablesType(storage);
    const typesType = generateStorageTypesType(storage);
    const namespacesType = generateStorageNamespacesType(storage.namespaces);

    return `{ readonly tables: ${tablesType}; readonly types: ${typesType}; readonly namespaces: ${namespacesType}; readonly storageHash: ${storageHashTypeName} }`;
  },

  generateModelStorageType(_modelName: string, model: ContractModel): string {
    const sqlModel = model as ContractModel<SqlModelStorage>;
    const tableName = sqlModel.storage.table;
    const storageFields = sqlModel.storage.fields;

    const storageParts = [`readonly table: ${serializeValue(tableName)}`];
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
    model: ContractModel,
    contract: Contract,
  ): Record<string, unknown> | undefined {
    const sqlModel = model as ContractModel<SqlModelStorage>;
    const storageField = sqlModel.storage?.fields?.[fieldName];
    if (!storageField) return undefined;

    const storage = contract.storage as unknown as SqlStorage | undefined;
    if (!storage) return undefined;

    const tableName = sqlModel.storage.table;
    const table: StorageTable | undefined = findTableByName(storage, tableName);
    if (!table) return undefined;

    const column = table.columns[storageField.column];
    if (!column) return undefined;

    if (column.typeRef) {
      const typeInstance = findTypeByName(storage, column.typeRef);
      if (typeInstance === undefined) return undefined;
      if (isPostgresEnumStorageEntry(typeInstance)) {
        return { values: typeInstance.values };
      }
      // Fall back to structural codec-triple access when the literal
      // bypasses the runtime normaliser (e.g. test fixtures or
      // hand-written descriptor inputs that omit the
      // `kind: 'codec-instance'` discriminator).
      const codecShape = typeInstance as Partial<StorageTypeInstance>;
      return codecShape.typeParams;
    }
    return column.typeParams;
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
      "export type Tables = Contract['storage']['tables'];",
      "export type Models = Contract['models'];",
    ].join('\n');
  },
} as const;

function emitTableType(table: StorageTable): string {
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

  const tableParts: string[] = [
    `namespaceId: ${serializeValue(table.namespaceId)}`,
    `columns: { ${columns.join('; ')} }`,
  ];

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
      const tgtNs = `readonly namespaceId: ${serializeValue(fk.target.namespaceId)}; `;
      return `{ readonly source: { readonly columns: readonly [${srcCols}] }; readonly target: { ${tgtNs}readonly table: ${serializeValue(fk.target.table)}; readonly columns: readonly [${tgtCols}] }${name}; readonly constraint: ${fk.constraint}; readonly index: ${fk.index} }`;
    })
    .join(', ');
  tableParts.push(`foreignKeys: readonly [${fks}]`);

  return `{ ${tableParts.join('; ')} }`;
}

/**
 * Tables are emitted as a flat `{ [tableName]: ... }` map keyed by table
 * name. Each table entry carries `namespaceId` as a first-class field;
 * the namespace coordinate is preserved in the type without nesting
 * the map shape. Cross-namespace name collisions are forbidden by
 * the same rule that disallows duplicate table names in any single
 * SQL family contract.
 */
function generateTablesType(storage: SqlStorage): string {
  const tableEntries: string[] = [];
  for (const { name: tableName, table } of iterateTablesWithCoords(storage)) {
    tableEntries.push(`readonly ${tableName}: ${emitTableType(table)}`);
  }
  tableEntries.sort();
  if (tableEntries.length === 0) {
    return '{}';
  }
  return `{ ${tableEntries.join('; ')} }`;
}

function generateStorageTypesType(storage: SqlStorage): string {
  const typesByNamespace =
    storage.typesByNamespace ?? (storage.types ? { [UNBOUND_NAMESPACE_ID]: storage.types } : {});
  if (Object.keys(typesByNamespace).length === 0) {
    return 'Record<string, never>';
  }

  let totalTypes = 0;
  for (const bucket of Object.values(typesByNamespace)) totalTypes += Object.keys(bucket).length;
  if (totalTypes === 0) {
    return 'Record<string, never>';
  }

  function emitTypeEntry(
    typeName: string,
    typeInstance: StorageTypeInstance | PostgresEnumStorageEntry,
  ): string {
    if (isPostgresEnumStorageEntry(typeInstance)) {
      const codecId = serializeValue(
        // `codecBinding.codecId` lives on the live IR-class instance;
        // raw JSON envelopes carry `codecId` as an enumerable own
        // property. Read the structural-shape field so the emitter
        // works against both runtime forms.
        typeInstance.codecId,
      );
      const nativeType = serializeValue(typeInstance.nativeType);
      const typeParamsStr = serializeTypeParamsLiteral({
        values: typeInstance.values as unknown as readonly unknown[],
      });
      // Emit the resolved codec view (kind: 'codec-instance') so the
      // emitted .d.ts shape stays uniform across slot variants and
      // satisfies the polymorphic slot's structural alphabet. The
      // persisted JSON envelope still carries the IR's narrower kind
      // discriminator; the d.ts is the type-level codec-resolved view.
      return `readonly ${typeName}: { readonly kind: 'codec-instance'; readonly codecId: ${codecId}; readonly nativeType: ${nativeType}; readonly typeParams: ${typeParamsStr} }`;
    }
    // The slot is polymorphic at the framework level; codec-instance
    // entries are the only non-IR-class kind today. The runtime
    // `SqlStorage` constructor stamps `kind: 'codec-instance'` on
    // plain codec triples; the emitter is forgiving about literal
    // inputs that bypass the constructor (test fixtures, hand-written
    // descriptors) and treats anything with the codec-triple shape as
    // a codec-instance.
    const codecInstanceShape = typeInstance as Partial<StorageTypeInstance>;
    if (
      typeof codecInstanceShape.codecId !== 'string' ||
      typeof codecInstanceShape.nativeType !== 'string'
    ) {
      throw new Error(
        `Unknown storage type kind for "${typeName}"; expected a codec-instance triple or a known IR-class kind.`,
      );
    }
    const codecId = serializeValue(codecInstanceShape.codecId);
    const nativeType = serializeValue(codecInstanceShape.nativeType);
    const typeParamsStr = serializeTypeParamsLiteral(codecInstanceShape.typeParams);
    return `readonly ${typeName}: { readonly kind: 'codec-instance'; readonly codecId: ${codecId}; readonly nativeType: ${nativeType}; readonly typeParams: ${typeParamsStr} }`;
  }

  const typeEntries: string[] = [];
  for (const { name: typeName, entry: typeInstance } of iterateTypesWithCoords(storage)) {
    typeEntries.push(emitTypeEntry(typeName, typeInstance));
  }
  return `{ ${typeEntries.join('; ')} }`;
}

function generateStorageNamespacesType(namespaces: SqlStorage['namespaces']): string {
  const entries = Object.entries(namespaces ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return 'Record<string, never>';
  }
  const parts: string[] = [];
  for (const [name, ns] of entries) {
    parts.push(`readonly ${serializeObjectKey(name)}: { readonly id: ${serializeValue(ns.id)} }`);
  }
  return `{ ${parts.join('; ')} }`;
}
