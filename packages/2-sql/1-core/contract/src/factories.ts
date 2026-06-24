import { asNamespaceId, type ScalarFieldType } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  applyFkDefaults,
  ForeignKey,
  type ForeignKeyOptions,
  Index,
  PrimaryKey,
  type SqlModelFieldStorage,
  type SqlModelStorage,
  StorageColumn,
  type StorageColumnInput,
  StorageTable,
  UniqueConstraint,
} from './types';

export function col(
  nativeType: string,
  codecId: string,
  nullable = false,
  opts?: { readonly many?: boolean },
): StorageColumn {
  return new StorageColumn({
    nativeType,
    codecId,
    nullable,
    ...(opts?.many !== undefined && { many: opts.many }),
  });
}

export function pk(...columns: readonly string[]): PrimaryKey {
  return new PrimaryKey({ columns });
}

export function unique(...columns: readonly string[]): UniqueConstraint {
  return new UniqueConstraint({ columns });
}

export function index(...columns: readonly string[]): Index {
  return new Index({ columns });
}

export function fk(
  srcTableName: string,
  srcColumns: readonly string[],
  targetTableName: string,
  targetColumns: readonly string[],
  opts?: ForeignKeyOptions & { constraint?: boolean; index?: boolean; namespaceId?: string },
): ForeignKey {
  const defaults = applyFkDefaults({ constraint: opts?.constraint, index: opts?.index });
  const namespaceId = asNamespaceId(opts?.namespaceId ?? UNBOUND_NAMESPACE_ID);
  return new ForeignKey({
    source: { namespaceId, tableName: srcTableName, columns: srcColumns },
    target: { namespaceId, tableName: targetTableName, columns: targetColumns },
    ...(opts?.name !== undefined && { name: opts.name }),
    ...(opts?.onDelete !== undefined && { onDelete: opts.onDelete }),
    ...(opts?.onUpdate !== undefined && { onUpdate: opts.onUpdate }),
    constraint: defaults.constraint,
    index: defaults.index,
  });
}

export function table(
  columns: Record<string, StorageColumn | StorageColumnInput>,
  opts?: {
    pk?: PrimaryKey;
    uniques?: readonly UniqueConstraint[];
    indexes?: readonly Index[];
    fks?: readonly ForeignKey[];
  },
): StorageTable {
  return new StorageTable({
    columns,
    ...(opts?.pk !== undefined && { primaryKey: opts.pk }),
    uniques: opts?.uniques ?? [],
    indexes: opts?.indexes ?? [],
    foreignKeys: opts?.fks ?? [],
  });
}

export function model(
  tableName: string,
  fields: Record<string, SqlModelFieldStorage>,
  relations: Record<string, unknown> = {},
  namespaceId: string = UNBOUND_NAMESPACE_ID,
): {
  storage: SqlModelStorage;
  fields: Record<string, { readonly nullable: boolean; readonly type: ScalarFieldType }>;
  relations: Record<string, unknown>;
} {
  const storage: SqlModelStorage = { table: tableName, namespaceId, fields };
  const domainFields = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      {
        nullable: field.nullable ?? false,
        type: { kind: 'scalar' as const, codecId: field.codecId ?? 'core/unknown@1' },
      },
    ]),
  ) as Record<string, { nullable: boolean; type: ScalarFieldType }>;
  return {
    storage,
    fields: domainFields,
    relations,
  };
}
