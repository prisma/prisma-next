import type { ColumnDefault } from '@prisma-next/contract/types';
import type {
  DependencyIR,
  PrimaryKey,
  SqlAnnotations,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlReferentialAction,
  SqlSchemaIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';

const REFERENTIAL_ACTIONS = new Set<SqlReferentialAction>([
  'noAction',
  'restrict',
  'cascade',
  'setNull',
  'setDefault',
]);

export type PrintableSqlColumnDefault = string | ColumnDefault;

type ColumnDefaultLiteralValue = Extract<ColumnDefault, { readonly kind: 'literal' }>['value'];

export type PslPrintableSqlColumn = {
  readonly name: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  readonly default?: PrintableSqlColumnDefault;
  readonly annotations?: SqlAnnotations;
};

export type PslPrintableSqlTable = {
  readonly name: string;
  readonly columns: Record<string, PslPrintableSqlColumn>;
  readonly primaryKey?: PrimaryKey;
  readonly foreignKeys: readonly SqlForeignKeyIR[];
  readonly uniques: readonly SqlUniqueIR[];
  readonly indexes: readonly SqlIndexIR[];
  readonly annotations?: SqlAnnotations;
};

export type PslPrintableSqlSchemaIR = Omit<SqlSchemaIR, 'tables'> & {
  readonly tables: Record<string, PslPrintableSqlTable>;
};

export function validatePrintableSqlSchemaIR(value: unknown): PslPrintableSqlSchemaIR {
  const root = expectRecord(value, 'schema');

  return {
    tables: validateTables(root['tables'], 'schema.tables'),
    dependencies: validateDependencies(root['dependencies'], 'schema.dependencies'),
    ...ifDefined('annotations', validateAnnotations(root['annotations'], 'schema.annotations')),
  };
}

function validateTables(value: unknown, path: string): Record<string, PslPrintableSqlTable> {
  const tables = expectRecord(value, path);
  const validated: Record<string, PslPrintableSqlTable> = {};

  for (const [tableName, tableValue] of Object.entries(tables)) {
    const tablePath = `${path}.${tableName}`;
    const table = expectRecord(tableValue, tablePath);

    validated[tableName] = {
      name: expectString(table['name'], `${tablePath}.name`),
      columns: validateColumns(table['columns'], `${tablePath}.columns`),
      foreignKeys: validateForeignKeys(table['foreignKeys'], `${tablePath}.foreignKeys`),
      uniques: validateUniques(table['uniques'], `${tablePath}.uniques`),
      indexes: validateIndexes(table['indexes'], `${tablePath}.indexes`),
      ...ifDefined(
        'primaryKey',
        validatePrimaryKey(table['primaryKey'], `${tablePath}.primaryKey`),
      ),
      ...ifDefined(
        'annotations',
        validateAnnotations(table['annotations'], `${tablePath}.annotations`),
      ),
    };
  }

  return validated;
}

function validateColumns(value: unknown, path: string): Record<string, PslPrintableSqlColumn> {
  const columns = expectRecord(value, path);
  const validated: Record<string, PslPrintableSqlColumn> = {};

  for (const [columnName, columnValue] of Object.entries(columns)) {
    const columnPath = `${path}.${columnName}`;
    const column = expectRecord(columnValue, columnPath);

    validated[columnName] = {
      name: expectString(column['name'], `${columnPath}.name`),
      nativeType: expectString(column['nativeType'], `${columnPath}.nativeType`),
      nullable: expectBoolean(column['nullable'], `${columnPath}.nullable`),
      ...ifDefined('default', validateColumnDefault(column['default'], `${columnPath}.default`)),
      ...ifDefined(
        'annotations',
        validateAnnotations(column['annotations'], `${columnPath}.annotations`),
      ),
    };
  }

  return validated;
}

function validatePrimaryKey(value: unknown, path: string): PrimaryKey | undefined {
  if (value === undefined) {
    return undefined;
  }

  const primaryKey = expectRecord(value, path);
  return {
    columns: validateStringArray(primaryKey['columns'], `${path}.columns`),
    ...ifDefined('name', validateOptionalString(primaryKey['name'], `${path}.name`)),
  };
}

function validateForeignKeys(value: unknown, path: string): readonly SqlForeignKeyIR[] {
  const foreignKeys = expectArray(value, path);
  return foreignKeys.map((foreignKey, index) => {
    const foreignKeyPath = `${path}[${index}]`;
    const record = expectRecord(foreignKey, foreignKeyPath);

    return {
      columns: validateStringArray(record['columns'], `${foreignKeyPath}.columns`),
      referencedTable: expectString(record['referencedTable'], `${foreignKeyPath}.referencedTable`),
      referencedColumns: validateStringArray(
        record['referencedColumns'],
        `${foreignKeyPath}.referencedColumns`,
      ),
      ...ifDefined('name', validateOptionalString(record['name'], `${foreignKeyPath}.name`)),
      ...ifDefined(
        'onDelete',
        validateReferentialAction(record['onDelete'], `${foreignKeyPath}.onDelete`),
      ),
      ...ifDefined(
        'onUpdate',
        validateReferentialAction(record['onUpdate'], `${foreignKeyPath}.onUpdate`),
      ),
      ...ifDefined(
        'annotations',
        validateAnnotations(record['annotations'], `${foreignKeyPath}.annotations`),
      ),
    };
  });
}

function validateUniques(value: unknown, path: string): readonly SqlUniqueIR[] {
  const uniques = expectArray(value, path);
  return uniques.map((uniqueValue, index) => {
    const uniquePath = `${path}[${index}]`;
    const unique = expectRecord(uniqueValue, uniquePath);

    return {
      columns: validateStringArray(unique['columns'], `${uniquePath}.columns`),
      ...ifDefined('name', validateOptionalString(unique['name'], `${uniquePath}.name`)),
      ...ifDefined(
        'annotations',
        validateAnnotations(unique['annotations'], `${uniquePath}.annotations`),
      ),
    };
  });
}

function validateIndexes(value: unknown, path: string): readonly SqlIndexIR[] {
  const indexes = expectArray(value, path);
  return indexes.map((indexValue, index) => {
    const indexPath = `${path}[${index}]`;
    const record = expectRecord(indexValue, indexPath);

    return {
      columns: validateStringArray(record['columns'], `${indexPath}.columns`),
      unique: expectBoolean(record['unique'], `${indexPath}.unique`),
      ...ifDefined('name', validateOptionalString(record['name'], `${indexPath}.name`)),
      ...ifDefined(
        'annotations',
        validateAnnotations(record['annotations'], `${indexPath}.annotations`),
      ),
    };
  });
}

function validateDependencies(value: unknown, path: string): readonly DependencyIR[] {
  const dependencies = expectArray(value, path);
  return dependencies.map((dependencyValue, index) => {
    const dependencyPath = `${path}[${index}]`;
    const dependency = expectRecord(dependencyValue, dependencyPath);

    return {
      id: expectString(dependency['id'], `${dependencyPath}.id`),
    };
  });
}

function validateAnnotations(value: unknown, path: string): SqlAnnotations | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectRecord(value, path);
}

function validateColumnDefault(
  value: unknown,
  path: string,
): PrintableSqlColumnDefault | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  const columnDefault = expectRecord(value, path);
  const kind = expectString(columnDefault['kind'], `${path}.kind`);

  if (kind === 'literal') {
    if (!Object.hasOwn(columnDefault, 'value')) {
      throw new Error(`${path}.value must be present for literal defaults`);
    }
    return {
      kind: 'literal',
      value: columnDefault['value'] as ColumnDefaultLiteralValue,
    };
  }

  if (kind === 'function') {
    return {
      kind: 'function',
      expression: expectString(columnDefault['expression'], `${path}.expression`),
    };
  }

  throw new Error(`${path}.kind must be "literal" or "function"`);
}

function validateReferentialAction(value: unknown, path: string): SqlReferentialAction | undefined {
  if (value === undefined) {
    return undefined;
  }

  const action = expectString(value, path) as SqlReferentialAction;
  if (!REFERENTIAL_ACTIONS.has(action)) {
    throw new Error(
      `${path} must be one of ${[...REFERENTIAL_ACTIONS].map((item) => `"${item}"`).join(', ')}`,
    );
  }
  return action;
}

function validateStringArray(value: unknown, path: string): readonly string[] {
  const items = expectArray(value, path);
  return items.map((item, index) => expectString(item, `${path}[${index}]`));
}

function validateOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectString(value, path);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }

  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string`);
  }

  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${path} must be a boolean`);
  }

  return value;
}

function ifDefined<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): { readonly [K in TKey]: TValue } | Record<string, never> {
  if (value === undefined) {
    return {};
  }

  return { [key]: value } as { readonly [K in TKey]: TValue };
}
