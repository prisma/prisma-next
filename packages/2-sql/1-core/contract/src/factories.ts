import type { ScalarFieldType } from '@prisma-next/contract/types';
import type {
  ForeignKey,
  ForeignKeyOptions,
  ForeignKeyReferences,
  Index,
  PrimaryKey,
  SqlModelFieldStorage,
  SqlModelStorage,
  StorageColumn,
  StorageTable,
  UniqueConstraint,
} from './types';
import { applyFkDefaults } from './types';

export function col(nativeType: string, codecId: string, nullable = false): StorageColumn {
  return {
    nativeType,
    codecId,
    nullable,
  };
}

export function pk(...columns: readonly string[]): PrimaryKey {
  return {
    columns,
  };
}

export function unique(...columns: readonly string[]): UniqueConstraint {
  return {
    columns,
  };
}

export function index(...columns: readonly string[]): Index {
  return {
    columns,
  };
}

export function fk(
  columns: readonly string[],
  refTable: string,
  refColumns: readonly string[],
  opts?: ForeignKeyOptions & { constraint?: boolean; index?: boolean },
): ForeignKey {
  const references: ForeignKeyReferences = {
    table: refTable,
    columns: refColumns,
  };

  return {
    columns,
    references,
    ...(opts?.name !== undefined && { name: opts.name }),
    ...(opts?.onDelete !== undefined && { onDelete: opts.onDelete }),
    ...(opts?.onUpdate !== undefined && { onUpdate: opts.onUpdate }),
    ...applyFkDefaults({ constraint: opts?.constraint, index: opts?.index }),
  };
}

export function table(
  columns: Record<string, StorageColumn>,
  opts?: {
    pk?: PrimaryKey;
    uniques?: readonly UniqueConstraint[];
    indexes?: readonly Index[];
    fks?: readonly ForeignKey[];
  },
): StorageTable {
  return {
    columns,
    ...(opts?.pk !== undefined && { primaryKey: opts.pk }),
    uniques: opts?.uniques ?? [],
    indexes: opts?.indexes ?? [],
    foreignKeys: opts?.fks ?? [],
  };
}

export function model(
  tableName: string,
  fields: Record<string, SqlModelFieldStorage>,
  relations: Record<string, unknown> = {},
): {
  storage: SqlModelStorage;
  fields: Record<string, { readonly nullable: boolean; readonly type?: ScalarFieldType }>;
  relations: Record<string, unknown>;
} {
  const storage: SqlModelStorage = { table: tableName, fields };
  const domainFields = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      {
        nullable: field.nullable ?? false,
        ...(field.codecId !== undefined
          ? { type: { kind: 'scalar' as const, codecId: field.codecId } }
          : {}),
      },
    ]),
  ) as Record<string, { nullable: boolean; type?: ScalarFieldType }>;
  return {
    storage,
    fields: domainFields,
    relations,
  };
}
