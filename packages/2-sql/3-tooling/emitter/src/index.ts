import type {
  Contract,
  GenerateContractTypesOptions,
  TypeRenderContext,
  TypeRenderEntry,
  TypesImportSpec,
  ValidationContext,
} from '@prisma-next/contract/types';
import type {
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';

type IRModelField = { readonly column: string };
type IRModelStorage = {
  readonly table: string;
  readonly fields?: Record<string, IRModelField>;
};
type IRModelDefinition = {
  readonly storage: IRModelStorage;
  readonly fields?: Record<string, unknown>;
  readonly relations: Record<string, unknown>;
  readonly owner?: string;
};

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

  validateTypes(contract: Contract, _ctx: ValidationContext): void {
    const storage = contract.storage as unknown as SqlStorage | undefined;
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

  validateStructure(contract: Contract): void {
    if (contract.targetFamily !== 'sql') {
      throw new Error(`Expected targetFamily "sql", got "${contract.targetFamily}"`);
    }

    const storage = contract.storage as unknown as SqlStorage | undefined;
    if (!storage || !storage.tables) {
      throw new Error('SQL contract must have storage.tables');
    }

    const models = contract.models as Record<string, IRModelDefinition> | undefined;
    const tableNames = new Set(Object.keys(storage.tables));

    if (models) {
      for (const [modelName, modelUnknown] of Object.entries(models)) {
        const model = modelUnknown as IRModelDefinition;
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
    contract: Contract,
    codecTypeImports: ReadonlyArray<TypesImportSpec>,
    operationTypeImports: ReadonlyArray<TypesImportSpec>,
    hashes: {
      readonly storageHash: string;
      readonly executionHash?: string;
      readonly profileHash: string;
    },
    options?: GenerateContractTypesOptions,
  ): string {
    const parameterizedRenderers = options?.parameterizedRenderers;
    const parameterizedTypeImports = options?.parameterizedTypeImports;
    const storage = contract.storage as unknown as SqlStorage;
    const models = contract.models as Record<string, IRModelDefinition>;

    // Collect all type imports from three sources:
    // 1. Codec type imports (from adapters, targets, and extensions)
    // 2. Operation type imports (from adapters, targets, and extensions)
    // 3. Parameterized type imports (for parameterized codec renderers, may contain duplicates)
    const allImports: TypesImportSpec[] = [...codecTypeImports, ...operationTypeImports];

    if (parameterizedTypeImports) {
      allImports.push(...parameterizedTypeImports);
    }

    const queryOperationTypeImports = options?.queryOperationTypeImports ?? [];
    if (queryOperationTypeImports.length > 0) {
      allImports.push(...queryOperationTypeImports);
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
    const queryOperationTypes = queryOperationTypeImports
      .filter((imp) => imp.named === 'QueryOperationTypes')
      .map((imp) => imp.alias)
      .join(' & ');

    const renderCtx: TypeRenderContext = { codecTypesName: 'CodecTypes' };
    const storageType = this.generateStorageType(storage, 'StorageHash');
    const modelsType = this.generateModelsType(models, storage, parameterizedRenderers, renderCtx);
    const rootsType = this.generateRootsType(contract.roots);

    const executionHashType = hashes.executionHash
      ? `ExecutionHashBase<'${hashes.executionHash}'>`
      : 'ExecutionHashBase<string>';

    return `// ⚠️  GENERATED FILE - DO NOT EDIT
  // This file is automatically generated by 'prisma-next contract emit'.
  // To regenerate, run: prisma-next contract emit
  ${importLines.join('\n')}

  import type {
    ExecutionHashBase,
    ProfileHashBase,
    StorageHashBase,
  } from '@prisma-next/contract/types';
  import type {
    SqlContract,
    ContractWithTypeMaps,
    TypeMaps as TypeMapsType,
  } from '@prisma-next/sql-contract/types';

  export type StorageHash = StorageHashBase<'${hashes.storageHash}'>;
  export type ExecutionHash = ${executionHashType};
  export type ProfileHash = ProfileHashBase<'${hashes.profileHash}'>;

  export type CodecTypes = ${codecTypes || 'Record<string, never>'};
  export type LaneCodecTypes = CodecTypes;
  export type OperationTypes = ${operationTypes || 'Record<string, never>'};
  export type QueryOperationTypes = ${queryOperationTypes || 'Record<string, never>'};
  type DefaultLiteralValue<CodecId extends string, Encoded> =
    CodecId extends keyof CodecTypes
      ? CodecTypes[CodecId] extends { readonly output: infer O }
        ? O extends Date | bigint ? O : Encoded
        : Encoded
      : Encoded;

  export type TypeMaps = TypeMapsType<CodecTypes, OperationTypes, QueryOperationTypes>;

  type ContractBase = SqlContract<
  ${storageType},
  ${modelsType},
  StorageHash,
  ExecutionHash,
  ProfileHash
  > & {
    readonly target: ${this.serializeValue(contract.target)};
    readonly roots: ${rootsType};
    readonly capabilities: ${this.serializeValue(contract.capabilities)};
    readonly extensionPacks: ${this.serializeValue(contract.extensionPacks)};
    readonly execution: ${this.serializeValue(contract.execution)};
  };

  export type Contract = ContractWithTypeMaps<ContractBase, TypeMaps>;

  export type Tables = Contract['storage']['tables'];
  export type Models = Contract['models'];
  `;
  },

  generateRootsType(roots: Record<string, string> | undefined): string {
    if (!roots || Object.keys(roots).length === 0) {
      return 'Record<string, string>';
    }
    const entries = Object.entries(roots)
      .map(
        ([key, value]) => `readonly ${this.serializeObjectKey(key)}: ${this.serializeValue(value)}`,
      )
      .join('; ');
    return `{ ${entries} }`;
  },

  generateStorageType(storage: SqlStorage, storageHashType: string): string {
    const tables: string[] = [];
    for (const [tableName, table] of Object.entries(storage.tables).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const columns: string[] = [];
      for (const [colName, col] of Object.entries(table.columns)) {
        const nullable = col.nullable ? 'true' : 'false';
        const nativeType = `'${col.nativeType}'`;
        const codecId = `'${col.codecId}'`;
        const defaultSpec = col.default
          ? col.default.kind === 'literal'
            ? `; readonly default: { readonly kind: 'literal'; readonly value: DefaultLiteralValue<${codecId}, ${this.serializeValue(
                col.default.value,
              )}> }`
            : `; readonly default: { readonly kind: 'function'; readonly expression: ${this.serializeValue(
                col.default.expression,
              )} }`
          : '';
        columns.push(
          `readonly ${colName}: { readonly nativeType: ${nativeType}; readonly codecId: ${codecId}; readonly nullable: ${nullable}${defaultSpec} }`,
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
          const using =
            i.using !== undefined ? `; readonly using: ${this.serializeValue(i.using)}` : '';
          const config =
            i.config !== undefined ? `; readonly config: ${this.serializeValue(i.config)}` : '';
          return `{ readonly columns: readonly [${cols}]${name}${using}${config} }`;
        })
        .join(', ');
      tableParts.push(`indexes: readonly [${indexes}]`);

      const fks = table.foreignKeys
        .map((fk) => {
          const cols = fk.columns.map((c: string) => `'${c}'`).join(', ');
          const refCols = fk.references.columns.map((c: string) => `'${c}'`).join(', ');
          const name = fk.name ? `; readonly name: '${fk.name}'` : '';
          return `{ readonly columns: readonly [${cols}]; readonly references: { readonly table: '${fk.references.table}'; readonly columns: readonly [${refCols}] }${name}; readonly constraint: ${fk.constraint}; readonly index: ${fk.index} }`;
        })
        .join(', ');
      tableParts.push(`foreignKeys: readonly [${fks}]`);

      tables.push(`readonly ${tableName}: { ${tableParts.join('; ')} }`);
    }

    const typesType = this.generateStorageTypesType(storage.types);

    return `{ readonly tables: { ${tables.join('; ')} }; readonly types: ${typesType}; readonly storageHash: ${storageHashType} }`;
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
      entries.push(`readonly ${this.serializeObjectKey(key)}: ${serialized}`);
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
        entries.push(`readonly ${this.serializeObjectKey(k)}: ${this.serializeValue(v)}`);
      }
      return `{ ${entries.join('; ')} }`;
    }
    return 'unknown';
  },

  serializeObjectKey(key: string): string {
    if (/^[$A-Z_a-z][$\w]*$/.test(key)) {
      return key;
    }
    return this.serializeValue(key);
  },

  generateModelsType(
    models: Record<string, IRModelDefinition> | undefined,
    storage: SqlStorage,
    parameterizedRenderers: Map<string, TypeRenderEntry> | undefined,
    renderCtx: TypeRenderContext,
  ): string {
    if (!models) {
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
      if (table) {
        for (const [fieldName, field] of Object.entries(storageFields)) {
          const column = table.columns[field.column];
          if (!column) {
            fields.push(`readonly ${fieldName}: unknown`);
            storageFieldParts.push(`readonly ${fieldName}: { readonly column: '${field.column}' }`);
            continue;
          }

          const jsType = this.generateColumnType(
            column,
            storage,
            parameterizedRenderers,
            renderCtx,
          );
          fields.push(`readonly ${fieldName}: ${jsType}`);
          storageFieldParts.push(`readonly ${fieldName}: { readonly column: '${field.column}' }`);
        }
      } else {
        for (const [fieldName, field] of Object.entries(storageFields)) {
          fields.push(`readonly ${fieldName}: unknown`);
          storageFieldParts.push(`readonly ${fieldName}: { readonly column: '${field.column}' }`);
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
          const localFields = on.localFields.map((f) => this.serializeValue(f)).join(', ');
          const targetFields = on.targetFields.map((f) => this.serializeValue(f)).join(', ');
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
        modelParts.push(`owner: ${this.serializeValue(model.owner)}`);
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
} as const;
