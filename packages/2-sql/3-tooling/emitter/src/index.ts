import type { Contract, ContractField, ContractModel } from '@prisma-next/contract/types';
import {
  generateCodecTypeIntersection,
  generateContractFieldDescriptor,
  serializeObjectKey,
  serializeValue,
} from '@prisma-next/emitter/domain-type-generation';
import type {
  GenerateContractTypesOptions,
  ValidationContext,
} from '@prisma-next/framework-components/emission';
import type { SqlModelStorage, SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
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

function isNonScalarField(field: unknown): field is ContractField {
  if (typeof field !== 'object' || field === null) return false;
  const f = field as Record<string, unknown>;
  if (typeof f['type'] !== 'object' || f['type'] === null) return false;
  const t = f['type'] as Record<string, unknown>;
  return t['kind'] !== 'scalar';
}

export const sqlEmission = {
  id: 'sql',

  validateTypes(contract: Contract, _ctx: ValidationContext): void {
    const storage = contract.storage as unknown as SqlStorage | undefined;
    if (!storage || !storage.tables) {
      return;
    }

    const typeIdRegex = /^([^/]+)\/([^@]+)@(\d+)$/;

    for (const [tableName, tableUnknown] of Object.entries(storage.tables)) {
      const table = tableUnknown as StorageTable;
      for (const [colName, colUnknown] of Object.entries(table.columns)) {
        const col = colUnknown as { codecId?: string };
        const codecId = col.codecId;
        if (!codecId) {
          throw new Error(`Column "${colName}" in table "${tableName}" is missing codecId`);
        }

        const match = codecId.match(typeIdRegex);
        if (!match || !match[1]) {
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
    if (!storage || !storage.tables) {
      throw new Error('SQL contract must have storage.tables');
    }

    const models = contract.models as Record<string, ContractModel<SqlModelStorage>>;
    const tableNames = new Set(Object.keys(storage.tables));

    if (models) {
      for (const [modelName, model] of Object.entries(models)) {
        if (!model.storage?.table) {
          throw new Error(`Model "${modelName}" is missing storage.table`);
        }

        const tableName = model.storage.table;
        if (!tableNames.has(tableName)) {
          throw new Error(`Model "${modelName}" references non-existent table "${tableName}"`);
        }

        const table: StorageTable | undefined = storage.tables[tableName];
        assertDefined(table, `Model "${modelName}" references non-existent table "${tableName}"`);

        if (!table.primaryKey) {
          throw new Error(`Model "${modelName}" table "${tableName}" is missing a primary key`);
        }

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

    for (const [tableName, tableUnknown] of Object.entries(storage.tables)) {
      const table = tableUnknown as StorageTable;
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
        for (const colName of fk.columns) {
          if (!columnNames.has(colName)) {
            throw new Error(
              `Table "${tableName}" foreignKey references non-existent column "${colName}"`,
            );
          }
        }

        if (!tableNames.has(fk.references.table)) {
          throw new Error(
            `Table "${tableName}" foreignKey references non-existent table "${fk.references.table}"`,
          );
        }

        const referencedTable: StorageTable | undefined = storage.tables[fk.references.table];
        assertDefined(
          referencedTable,
          `Table "${tableName}" foreignKey references non-existent table "${fk.references.table}"`,
        );

        const referencedColumnNames = new Set(Object.keys(referencedTable.columns));
        for (const colName of fk.references.columns) {
          if (!referencedColumnNames.has(colName)) {
            throw new Error(
              `Table "${tableName}" foreignKey references non-existent column "${colName}" in table "${fk.references.table}"`,
            );
          }
        }

        if (fk.columns.length !== fk.references.columns.length) {
          throw new Error(
            `Table "${tableName}" foreignKey column count (${fk.columns.length}) does not match referenced column count (${fk.references.columns.length})`,
          );
        }
      }
    }
  },

  generateStorageType(contract: Contract, storageHashTypeName: string): string {
    const storage = contract.storage as unknown as SqlStorage;
    const tables: string[] = [];
    for (const [tableName, table] of Object.entries(storage.tables).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
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
          const name = i.name ? `; readonly name: ${serializeValue(i.name)}` : '';
          const using = i.using !== undefined ? `; readonly using: ${serializeValue(i.using)}` : '';
          const config =
            i.config !== undefined ? `; readonly config: ${serializeValue(i.config)}` : '';
          return `{ readonly columns: readonly [${cols}]${name}${using}${config} }`;
        })
        .join(', ');
      tableParts.push(`indexes: readonly [${indexes}]`);

      const fks = table.foreignKeys
        .map((fk) => {
          const cols = fk.columns.map((c: string) => serializeValue(c)).join(', ');
          const refCols = fk.references.columns.map((c: string) => serializeValue(c)).join(', ');
          const name = fk.name ? `; readonly name: ${serializeValue(fk.name)}` : '';
          return `{ readonly columns: readonly [${cols}]; readonly references: { readonly table: ${serializeValue(fk.references.table)}; readonly columns: readonly [${refCols}] }${name}; readonly constraint: ${fk.constraint}; readonly index: ${fk.index} }`;
        })
        .join(', ');
      tableParts.push(`foreignKeys: readonly [${fks}]`);

      tables.push(`readonly ${tableName}: { ${tableParts.join('; ')} }`);
    }

    const typesType = generateStorageTypesType(storage.types);

    return `{ readonly tables: { ${tables.join('; ')} }; readonly types: ${typesType}; readonly storageHash: ${storageHashTypeName} }`;
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

  generateModelsType(contract: Contract, options?: GenerateContractTypesOptions): string {
    const storage = contract.storage as unknown as SqlStorage;
    const models = contract.models as Record<string, ContractModel<SqlModelStorage>> | undefined;

    if (!models || Object.keys(models).length === 0) {
      return 'Record<string, never>';
    }

    const modelTypes: string[] = [];
    for (const [modelName, model] of Object.entries(models).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const fields: string[] = [];
      const storageFieldParts: string[] = [];
      const tableName = model.storage.table;
      const table = storage.tables[tableName];

      const storageFields = model.storage.fields ?? {};
      const domainFields = model.fields as Record<string, ContractField> | undefined;
      if (table) {
        for (const [fieldName, field] of Object.entries(storageFields)) {
          storageFieldParts.push(
            `readonly ${fieldName}: { readonly column: ${serializeValue(field.column)} }`,
          );

          const domainField = domainFields?.[fieldName];
          if (isNonScalarField(domainField)) {
            fields.push(generateContractFieldDescriptor(fieldName, domainField));
            continue;
          }

          const column = table.columns[field.column];
          if (!column) {
            fields.push(
              `readonly ${fieldName}: { readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'unknown' } }`,
            );
            continue;
          }

          const nullable = column.nullable ?? false;
          const resolvedTypeParams =
            column.typeParams && Object.keys(column.typeParams).length > 0
              ? column.typeParams
              : column.typeRef
                ? storage.types?.[column.typeRef]?.typeParams
                : undefined;
          const renderer = options?.parameterizedRenderers?.get(column.codecId);
          if (renderer && resolvedTypeParams && Object.keys(resolvedTypeParams).length > 0) {
            const renderedType = renderer.render(resolvedTypeParams, {
              codecTypesName: 'CodecTypes',
            });
            const nullSuffix = nullable ? ' | null' : '';
            fields.push(`readonly ${fieldName}: ${renderedType}${nullSuffix}`);
          } else {
            const fieldTypeParamsSpec =
              resolvedTypeParams && Object.keys(resolvedTypeParams).length > 0
                ? `; readonly typeParams: ${serializeTypeParamsLiteral(resolvedTypeParams)}`
                : '';
            fields.push(
              `readonly ${fieldName}: { readonly nullable: ${nullable}; readonly type: { readonly kind: 'scalar'; readonly codecId: ${serializeValue(column.codecId)}${fieldTypeParamsSpec} } }`,
            );
          }
        }
      } else {
        for (const [fieldName, field] of Object.entries(storageFields)) {
          storageFieldParts.push(
            `readonly ${fieldName}: { readonly column: ${serializeValue(field.column)} }`,
          );

          const domainField = domainFields?.[fieldName];
          if (isNonScalarField(domainField)) {
            fields.push(generateContractFieldDescriptor(fieldName, domainField));
            continue;
          }

          fields.push(
            `readonly ${fieldName}: { readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'unknown' } }`,
          );
        }
      }

      const relations: string[] = [];
      const modelRels = model.relations as Record<string, unknown>;
      for (const [relName, rel] of Object.entries(modelRels)) {
        if (typeof rel !== 'object' || rel === null) continue;
        const relObj = rel as Record<string, unknown>;
        const relParts: string[] = [];
        if (relObj['to']) relParts.push(`readonly to: '${relObj['to']}'`);
        if (relObj['cardinality'])
          relParts.push(`readonly cardinality: '${relObj['cardinality']}'`);
        const on = relObj['on'] as { localFields?: string[]; targetFields?: string[] } | undefined;
        if (on?.localFields && on.targetFields) {
          const localFields = on.localFields.map((f) => serializeValue(f)).join(', ');
          const targetFields = on.targetFields.map((f) => serializeValue(f)).join(', ');
          relParts.push(
            `readonly on: { readonly localFields: readonly [${localFields}]; readonly targetFields: readonly [${targetFields}] }`,
          );
        }
        if (relParts.length > 0) {
          relations.push(`readonly ${relName}: { ${relParts.join('; ')} }`);
        }
      }

      const storageParts = [`readonly table: '${tableName}'`];
      if (storageFieldParts.length > 0) {
        storageParts.push(`readonly fields: { ${storageFieldParts.join('; ')} }`);
      }

      const modelParts: string[] = [
        `readonly storage: { ${storageParts.join('; ')} }`,
        `readonly fields: { ${fields.join('; ')} }`,
        `readonly relations: { ${relations.join('; ')} }`,
      ];

      if (model.owner) {
        modelParts.push(`owner: ${serializeValue(model.owner)}`);
      }

      modelTypes.push(`readonly ${modelName}: { ${modelParts.join('; ')} }`);
    }

    return `{ ${modelTypes.join('; ')} }`;
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
    const queryOperationTypes = generateCodecTypeIntersection(
      queryOperationTypeImports,
      'QueryOperationTypes',
    );

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
    return 'TypeMapsType<CodecTypes, OperationTypes, QueryOperationTypes>';
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

function generateStorageTypesType(types: SqlStorage['types']): string {
  if (!types || Object.keys(types).length === 0) {
    return 'Record<string, never>';
  }

  const typeEntries: string[] = [];
  for (const [typeName, typeInstance] of Object.entries(types)) {
    const codecId = serializeValue(typeInstance.codecId);
    const nativeType = serializeValue(typeInstance.nativeType);
    const typeParamsStr = serializeTypeParamsLiteral(typeInstance.typeParams);
    typeEntries.push(
      `readonly ${typeName}: { readonly codecId: ${codecId}; readonly nativeType: ${nativeType}; readonly typeParams: ${typeParamsStr} }`,
    );
  }

  return `{ ${typeEntries.join('; ')} }`;
}
