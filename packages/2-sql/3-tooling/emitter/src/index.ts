import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  GenerateContractTypesOptions,
  TypeRenderContext,
  TypeRenderEntry,
  TypesImportSpec,
  ValidationContext,
} from '@prisma-next/contract/types';
import type {
  ModelDefinition,
  ModelField,
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { assertDefined } from '@prisma-next/utils/assertions';

/**
 * Resolves the typeParams for a column, either from inline typeParams or from typeRef.
 * Returns undefined if no typeParams are available.
 */
function resolveColumnTypeParams(
  column: StorageColumn,
  storage: SqlStorage,
): Record<string, unknown> | undefined {
  // Inline typeParams take precedence
  if (column.typeParams && Object.keys(column.typeParams).length > 0) {
    return column.typeParams;
  }
  // Check typeRef
  if (column.typeRef && storage.types) {
    const typeInstance = storage.types[column.typeRef] as StorageTypeInstance | undefined;
    if (typeInstance?.typeParams) {
      return typeInstance.typeParams;
    }
  }
  return undefined;
}

export const sqlTargetFamilyHook = {
  id: 'sql',

  validateTypes(ir: ContractIR, _ctx: ValidationContext): void {
    const storage = ir.storage as SqlStorage | undefined;
    if (!storage || !storage.tables) {
      return;
    }

    // Validate codec ID format (ns/name@version). Adapter-provided codecs are available regardless of contract.extensionPacks (which is for framework extensions); TypeScript prevents invalid usage and runtime validates availability.

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

  validateStructure(ir: ContractIR): void {
    if (ir.targetFamily !== 'sql') {
      throw new Error(`Expected targetFamily "sql", got "${ir.targetFamily}"`);
    }

    const storage = ir.storage as SqlStorage | undefined;
    if (!storage || !storage.tables) {
      throw new Error('SQL contract must have storage.tables');
    }

    const models = ir.models as Record<string, ModelDefinition> | undefined;
    const tableNames = new Set(Object.keys(storage.tables));

    if (models) {
      for (const [modelName, modelUnknown] of Object.entries(models)) {
        const model = modelUnknown as ModelDefinition;
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
        if (!model.fields || Object.keys(model.fields).length === 0) {
          throw new Error(`Model "${modelName}" is missing fields`);
        }

        for (const [fieldName, fieldUnknown] of Object.entries(model.fields)) {
          const field = fieldUnknown as ModelField;
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

      // Column structure (nullable, nativeType, codecId) and table arrays (uniques, indexes, foreignKeys)
      // are validated by Arktype schema validation - no need to re-check here.
      // We only validate logical consistency (foreign key references, model references, etc.)

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

        // Table existence guaranteed by Set.has() check above
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

  generateContractTypes(
    ir: ContractIR,
    codecTypeImports: ReadonlyArray<TypesImportSpec>,
    operationTypeImports: ReadonlyArray<TypesImportSpec>,
    hashes: { readonly coreHash: string; readonly profileHash: string },
    options?: GenerateContractTypesOptions,
  ): string {
    const parameterizedRenderers = options?.parameterizedRenderers;
    const parameterizedTypeImports = options?.parameterizedTypeImports;
    const storage = ir.storage as SqlStorage;
    const models = ir.models as Record<string, ModelDefinition>;

    // Collect all type imports from three sources:
    // 1. Codec type imports (from adapters, targets, and extensions)
    // 2. Operation type imports (from adapters, targets, and extensions)
    // 3. Parameterized type imports (for parameterized codec renderers, may contain duplicates)
    const allImports: TypesImportSpec[] = [...codecTypeImports, ...operationTypeImports];

    if (parameterizedTypeImports) {
      allImports.push(...parameterizedTypeImports);
    }

    // Deduplicate imports by package+named to avoid duplicate import statements.
    // Strategy: When the same package::named appears multiple times, keep the first
    // occurrence (and its alias); later duplicates with different aliases are silently ignored.
    //
    // Note: uniqueImports must be an array (not a Set) because:
    // - We need to preserve the full TypesImportSpec objects (package, named, alias)
    // - We need to preserve insertion order (first occurrence wins)
    // - seenImportKeys is a Set used only for O(1) duplicate detection
    const seenImportKeys = new Set<string>();
    const uniqueImports: TypesImportSpec[] = [];
    for (const imp of allImports) {
      const key = `${imp.package}::${imp.named}`;
      if (!seenImportKeys.has(key)) {
        seenImportKeys.add(key);
        uniqueImports.push(imp);
      }
    }

    // Generate import statements, omitting redundant "as Alias" when named === alias
    const importLines = uniqueImports.map((imp) => {
      // Simplify import when named === alias (e.g., `import type { Vector }` instead of `{ Vector as Vector }`)
      const importClause = imp.named === imp.alias ? imp.named : `${imp.named} as ${imp.alias}`;
      return `import type { ${importClause} } from '${imp.package}';`;
    });

    // Only intersect actual codec/operation type maps. Extra type-only imports (e.g. Vector<N>) are
    // included in importLines via codecTypeImports but must not be intersected into CodecTypes.
    const codecTypes = codecTypeImports
      .filter((imp) => imp.named === 'CodecTypes')
      .map((imp) => imp.alias)
      .join(' & ');
    const operationTypes = operationTypeImports
      .filter((imp) => imp.named === 'OperationTypes')
      .map((imp) => imp.alias)
      .join(' & ');

    const storageType = this.generateStorageType(storage);
    const modelsType = this.generateModelsType(models, storage, parameterizedRenderers);
    const relationsType = this.generateRelationsType(ir.relations);
    const mappingsType = this.generateMappingsType(models, storage, codecTypes, operationTypes);

    return `// ⚠️  GENERATED FILE - DO NOT EDIT
  // This file is automatically generated by 'prisma-next contract emit'.
  // To regenerate, run: prisma-next contract emit
  ${importLines.join('\n')}

  import type { CoreHashBase, ProfileHashBase } from '@prisma-next/contract/types';
  import type { SqlContract, SqlStorage, SqlMappings, ModelDefinition } from '@prisma-next/sql-contract/types';

  export type CoreHash = CoreHashBase<'${hashes.coreHash}'>;
  export type ProfileHash = ProfileHashBase<'${hashes.profileHash}'>;

  export type CodecTypes = ${codecTypes || 'Record<string, never>'};
  export type LaneCodecTypes = CodecTypes;
  export type OperationTypes = ${operationTypes || 'Record<string, never>'};

  export type Contract = SqlContract<
  ${storageType},
  ${modelsType},
  ${relationsType},
  ${mappingsType},
  CoreHash,
  ProfileHash
  >;

  export type Tables = Contract['storage']['tables'];
  export type Models = Contract['models'];
  export type Relations = Contract['relations'];
  `;
  },

  generateStorageType(storage: SqlStorage): string {
    const tables: string[] = [];
    for (const [tableName, table] of Object.entries(storage.tables)) {
      const columns: string[] = [];
      for (const [colName, col] of Object.entries(table.columns)) {
        const nullable = col.nullable ? 'true' : 'false';
        const nativeType = `'${col.nativeType}'`;
        const codecId = `'${col.codecId}'`;
        columns.push(
          `readonly ${colName}: { readonly nativeType: ${nativeType}; readonly codecId: ${codecId}; readonly nullable: ${nullable} }`,
        );
      }

      const tableParts: string[] = [`columns: { ${columns.join('; ')} }`];

      if (table.primaryKey) {
        const pkCols = table.primaryKey.columns.map((c) => `'${c}'`).join(', ');
        const pkName = table.primaryKey.name ? `; readonly name: '${table.primaryKey.name}'` : '';
        tableParts.push(`primaryKey: { readonly columns: readonly [${pkCols}]${pkName} }`);
      }

      const uniques = table.uniques
        .map((u) => {
          const cols = u.columns.map((c: string) => `'${c}'`).join(', ');
          const name = u.name ? `; readonly name: '${u.name}'` : '';
          return `{ readonly columns: readonly [${cols}]${name} }`;
        })
        .join(', ');
      tableParts.push(`uniques: readonly [${uniques}]`);

      const indexes = table.indexes
        .map((i) => {
          const cols = i.columns.map((c: string) => `'${c}'`).join(', ');
          const name = i.name ? `; readonly name: '${i.name}'` : '';
          return `{ readonly columns: readonly [${cols}]${name} }`;
        })
        .join(', ');
      tableParts.push(`indexes: readonly [${indexes}]`);

      const fks = table.foreignKeys
        .map((fk) => {
          const cols = fk.columns.map((c: string) => `'${c}'`).join(', ');
          const refCols = fk.references.columns.map((c: string) => `'${c}'`).join(', ');
          const name = fk.name ? `; readonly name: '${fk.name}'` : '';
          return `{ readonly columns: readonly [${cols}]; readonly references: { readonly table: '${fk.references.table}'; readonly columns: readonly [${refCols}] }${name} }`;
        })
        .join(', ');
      tableParts.push(`foreignKeys: readonly [${fks}]`);

      tables.push(`readonly ${tableName}: { ${tableParts.join('; ')} }`);
    }

    const typesType = this.generateStorageTypesType(storage.types);

    return `{ readonly tables: { ${tables.join('; ')} }; readonly types: ${typesType} }`;
  },

  /**
   * Generates the TypeScript type for storage.types with literal types.
   * This preserves type params as literal values for precise typing.
   */
  generateStorageTypesType(types: SqlStorage['types']): string {
    if (!types || Object.keys(types).length === 0) {
      return 'Record<string, never>';
    }

    const typeEntries: string[] = [];
    for (const [typeName, typeInstance] of Object.entries(types)) {
      const codecId = `'${typeInstance.codecId}'`;
      const nativeType = `'${typeInstance.nativeType}'`;
      const typeParamsStr = this.serializeTypeParamsLiteral(typeInstance.typeParams);
      typeEntries.push(
        `readonly ${typeName}: { readonly codecId: ${codecId}; readonly nativeType: ${nativeType}; readonly typeParams: ${typeParamsStr} }`,
      );
    }

    return `{ ${typeEntries.join('; ')} }`;
  },

  /**
   * Serializes a typeParams object to a TypeScript literal type.
   * Converts { length: 1536 } to "{ readonly length: 1536 }".
   */
  serializeTypeParamsLiteral(params: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) {
      return 'Record<string, never>';
    }

    const entries: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      const serialized = this.serializeValue(value);
      entries.push(`readonly ${key}: ${serialized}`);
    }

    return `{ ${entries.join('; ')} }`;
  },

  /**
   * Serializes a value to a TypeScript literal type expression.
   */
  serializeValue(value: unknown): string {
    if (value === null) {
      return 'null';
    }
    if (value === undefined) {
      return 'undefined';
    }
    if (typeof value === 'string') {
      // Escape backslashes first, then single quotes
      const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `'${escaped}'`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (typeof value === 'bigint') {
      return `${value}n`;
    }
    if (Array.isArray(value)) {
      const items = value.map((v) => this.serializeValue(v)).join(', ');
      return `readonly [${items}]`;
    }
    if (typeof value === 'object') {
      const entries: string[] = [];
      for (const [k, v] of Object.entries(value)) {
        entries.push(`readonly ${k}: ${this.serializeValue(v)}`);
      }
      return `{ ${entries.join('; ')} }`;
    }
    return 'unknown';
  },

  generateModelsType(
    models: Record<string, ModelDefinition> | undefined,
    storage: SqlStorage,
    parameterizedRenderers?: Map<string, TypeRenderEntry>,
  ): string {
    if (!models) {
      return 'Record<string, never>';
    }

    const renderCtx: TypeRenderContext = { codecTypesName: 'CodecTypes' };

    const modelTypes: string[] = [];
    for (const [modelName, model] of Object.entries(models)) {
      const fields: string[] = [];
      const tableName = model.storage.table;
      const table = storage.tables[tableName];

      if (table) {
        for (const [fieldName, field] of Object.entries(model.fields)) {
          const column = table.columns[field.column];
          if (!column) {
            fields.push(`readonly ${fieldName}: { readonly column: '${field.column}' }`);
            continue;
          }

          const jsType = this.generateColumnType(
            column,
            storage,
            parameterizedRenderers,
            renderCtx,
          );
          fields.push(`readonly ${fieldName}: ${jsType}`);
        }
      } else {
        for (const [fieldName, field] of Object.entries(model.fields)) {
          fields.push(`readonly ${fieldName}: { readonly column: '${field.column}' }`);
        }
      }

      const relations: string[] = [];
      for (const [relName, rel] of Object.entries(model.relations)) {
        if (typeof rel === 'object' && rel !== null && 'on' in rel) {
          const on = rel.on as { parentCols?: string[]; childCols?: string[] };
          if (on.parentCols && on.childCols) {
            const parentCols = on.parentCols.map((c) => `'${c}'`).join(', ');
            const childCols = on.childCols.map((c) => `'${c}'`).join(', ');
            relations.push(
              `readonly ${relName}: { readonly on: { readonly parentCols: readonly [${parentCols}]; readonly childCols: readonly [${childCols}] } }`,
            );
          }
        }
      }

      const modelParts: string[] = [
        `storage: { readonly table: '${tableName}' }`,
        `fields: { ${fields.join('; ')} }`,
      ];

      if (relations.length > 0) {
        modelParts.push(`relations: { ${relations.join('; ')} }`);
      }

      modelTypes.push(`readonly ${modelName}: { ${modelParts.join('; ')} }`);
    }

    return `{ ${modelTypes.join('; ')} }`;
  },

  /**
   * Generates the TypeScript type expression for a column.
   * Uses parameterized renderer if the column has typeParams and a matching renderer exists,
   * otherwise falls back to CodecTypes[codecId]['output'].
   */
  generateColumnType(
    column: StorageColumn,
    storage: SqlStorage,
    parameterizedRenderers: Map<string, TypeRenderEntry> | undefined,
    renderCtx: TypeRenderContext,
  ): string {
    const typeParams = resolveColumnTypeParams(column, storage);
    const nullable = column.nullable ?? false;
    const fallbackType = `CodecTypes['${column.codecId}']['output']`;
    const renderer = typeParams && parameterizedRenderers?.get(column.codecId);
    const baseType = renderer ? renderer.render(typeParams, renderCtx) : fallbackType;

    return nullable ? `${baseType} | null` : baseType;
  },

  generateRelationsType(relations: Record<string, unknown> | undefined): string {
    if (!relations || Object.keys(relations).length === 0) {
      return 'Record<string, never>';
    }

    const tableEntries: string[] = [];
    for (const [tableName, relsValue] of Object.entries(relations)) {
      if (typeof relsValue !== 'object' || relsValue === null) {
        continue;
      }
      const rels = relsValue as Record<string, unknown>;
      const relationEntries: string[] = [];
      for (const [relName, relValue] of Object.entries(rels)) {
        if (typeof relValue !== 'object' || relValue === null) {
          relationEntries.push(`readonly ${relName}: unknown`);
          continue;
        }
        const { to, cardinality, on, through } = relValue as {
          readonly to?: string;
          readonly cardinality?: string;
          readonly on?: {
            readonly parentCols?: readonly string[];
            readonly childCols?: readonly string[];
          };
          readonly through?: {
            readonly table: string;
            readonly parentCols: readonly string[];
            readonly childCols: readonly string[];
          };
        };

        const parts: string[] = [];
        if (to) {
          parts.push(`readonly to: '${to}'`);
        }
        if (cardinality) {
          parts.push(`readonly cardinality: '${cardinality}'`);
        }
        if (on?.parentCols && on.childCols) {
          const parentCols = on.parentCols.map((c) => `'${c}'`).join(', ');
          const childCols = on.childCols.map((c) => `'${c}'`).join(', ');
          parts.push(
            `readonly on: { readonly parentCols: readonly [${parentCols}]; readonly childCols: readonly [${childCols}] }`,
          );
        }
        if (through) {
          const parentCols = through.parentCols.map((c) => `'${c}'`).join(', ');
          const childCols = through.childCols.map((c) => `'${c}'`).join(', ');
          parts.push(
            `readonly through: { readonly table: '${through.table}'; readonly parentCols: readonly [${parentCols}]; readonly childCols: readonly [${childCols}] }`,
          );
        }

        relationEntries.push(
          parts.length > 0
            ? `readonly ${relName}: { ${parts.join('; ')} }`
            : `readonly ${relName}: unknown`,
        );
      }
      tableEntries.push(`readonly ${tableName}: { ${relationEntries.join('; ')} }`);
    }

    return `{ ${tableEntries.join('; ')} }`;
  },

  generateMappingsType(
    models: Record<string, ModelDefinition> | undefined,
    storage: SqlStorage,
    codecTypes: string,
    operationTypes: string,
  ): string {
    if (!models) {
      return `SqlMappings & { readonly codecTypes: ${codecTypes || 'Record<string, never>'}; readonly operationTypes: ${operationTypes || 'Record<string, never>'}; }`;
    }

    const modelToTable: string[] = [];
    const tableToModel: string[] = [];
    const fieldToColumn: string[] = [];
    const columnToField: string[] = [];

    for (const [modelName, model] of Object.entries(models)) {
      const tableName = model.storage.table;
      modelToTable.push(`readonly ${modelName}: '${tableName}'`);
      tableToModel.push(`readonly ${tableName}: '${modelName}'`);

      const fieldMap: string[] = [];
      for (const [fieldName, field] of Object.entries(model.fields)) {
        fieldMap.push(`readonly ${fieldName}: '${field.column}'`);
      }

      if (fieldMap.length > 0) {
        fieldToColumn.push(`readonly ${modelName}: { ${fieldMap.join('; ')} }`);
      }

      if (storage.tables[tableName]) {
        const colMap: string[] = [];
        for (const [fieldName, field] of Object.entries(model.fields)) {
          colMap.push(`readonly ${field.column}: '${fieldName}'`);
        }

        if (colMap.length > 0) {
          columnToField.push(`readonly ${tableName}: { ${colMap.join('; ')} }`);
        }
      }
    }

    const parts: string[] = [];
    if (modelToTable.length > 0) {
      parts.push(`modelToTable: { ${modelToTable.join('; ')} }`);
    }
    if (tableToModel.length > 0) {
      parts.push(`tableToModel: { ${tableToModel.join('; ')} }`);
    }
    if (fieldToColumn.length > 0) {
      parts.push(`fieldToColumn: { ${fieldToColumn.join('; ')} }`);
    }
    if (columnToField.length > 0) {
      parts.push(`columnToField: { ${columnToField.join('; ')} }`);
    }
    parts.push(`codecTypes: ${codecTypes || 'Record<string, never>'}`);
    parts.push(`operationTypes: ${operationTypes || 'Record<string, never>'}`);

    return `{ ${parts.join('; ')} }`;
  },
} as const;
