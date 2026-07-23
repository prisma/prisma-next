/**
 * Contract-derived schema metadata for the REPL. Extracted once at session
 * start from the emitted contract JSON, it drives autocomplete and the
 * `.tables` / `.schema` / `.models` meta commands without needing the typed
 * contract surface.
 */

export interface ReplColumnInfo {
  readonly name: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  readonly isPrimaryKey: boolean;
}

export interface ReplTableInfo {
  readonly columns: readonly ReplColumnInfo[];
}

export interface ReplRelationTarget {
  readonly model: string;
  readonly namespace: string;
}

export interface ReplModelInfo {
  readonly fields: readonly string[];
  readonly relations: readonly string[];
  /** Relation name → target model coordinate, for resolving callback params. */
  readonly relationTargets: Readonly<Record<string, ReplRelationTarget>>;
  readonly table: string;
}

export interface ReplNamespaceInfo {
  readonly tables: Readonly<Record<string, ReplTableInfo>>;
  readonly models: Readonly<Record<string, ReplModelInfo>>;
  readonly enums: Readonly<Record<string, readonly string[]>>;
}

export interface ReplSchemaInfo {
  readonly namespaces: Readonly<Record<string, ReplNamespaceInfo>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordAt(value: unknown, ...path: readonly string[]): Record<string, unknown> {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return {};
    current = current[key];
  }
  return isRecord(current) ? current : {};
}

function extractTable(tableJson: unknown): ReplTableInfo {
  const columnsJson = recordAt(tableJson, 'columns');
  const primaryKeyColumns = new Set<string>();
  const pk = recordAt(tableJson, 'primaryKey')['columns'];
  if (Array.isArray(pk)) {
    for (const col of pk) {
      if (typeof col === 'string') primaryKeyColumns.add(col);
    }
  }
  const columns: ReplColumnInfo[] = Object.entries(columnsJson).map(([name, col]) => {
    const info = isRecord(col) ? col : {};
    return {
      name,
      nativeType: typeof info['nativeType'] === 'string' ? info['nativeType'] : 'unknown',
      nullable: info['nullable'] === true,
      isPrimaryKey: primaryKeyColumns.has(name),
    };
  });
  return { columns };
}

function extractModel(modelJson: unknown, sourceNamespace: string): ReplModelInfo {
  const storage = recordAt(modelJson, 'storage');
  const relationsJson = recordAt(modelJson, 'relations');
  const relationTargets: Record<string, ReplRelationTarget> = {};
  for (const [name, relation] of Object.entries(relationsJson)) {
    const to = recordAt(relation, 'to');
    const model = to['model'];
    if (typeof model === 'string') {
      relationTargets[name] = {
        model,
        namespace: typeof to['namespace'] === 'string' ? to['namespace'] : sourceNamespace,
      };
    }
  }
  return {
    fields: Object.keys(recordAt(modelJson, 'fields')),
    relations: Object.keys(relationsJson),
    relationTargets,
    table: typeof storage['table'] === 'string' ? storage['table'] : '',
  };
}

function extractEnums(enumsJson: Record<string, unknown>): Record<string, readonly string[]> {
  const enums: Record<string, readonly string[]> = {};
  for (const [name, enumJson] of Object.entries(enumsJson)) {
    const members = isRecord(enumJson) ? enumJson['members'] : undefined;
    const memberNames: string[] = [];
    if (Array.isArray(members)) {
      for (const member of members) {
        if (isRecord(member) && typeof member['name'] === 'string') {
          memberNames.push(member['name']);
        }
      }
    }
    enums[name] = memberNames;
  }
  return enums;
}

export function extractReplSchemaInfo(contractJson: unknown): ReplSchemaInfo {
  const domainNamespaces = recordAt(contractJson, 'domain', 'namespaces');
  const storageNamespaces = recordAt(contractJson, 'storage', 'namespaces');

  const namespaceIds = new Set([
    ...Object.keys(domainNamespaces),
    ...Object.keys(storageNamespaces),
  ]);
  const namespaces: Record<string, ReplNamespaceInfo> = {};

  for (const nsId of namespaceIds) {
    const tablesJson = recordAt(storageNamespaces[nsId], 'entries', 'table');
    const tables: Record<string, ReplTableInfo> = {};
    for (const [tableName, tableJson] of Object.entries(tablesJson)) {
      tables[tableName] = extractTable(tableJson);
    }

    const modelsJson = recordAt(domainNamespaces[nsId], 'models');
    const models: Record<string, ReplModelInfo> = {};
    for (const [modelName, modelJson] of Object.entries(modelsJson)) {
      models[modelName] = extractModel(modelJson, nsId);
    }

    namespaces[nsId] = {
      tables,
      models,
      enums: extractEnums(recordAt(domainNamespaces[nsId], 'enum')),
    };
  }

  return { namespaces };
}
