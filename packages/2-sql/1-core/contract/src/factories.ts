import type { ScalarFieldType } from '@prisma-next/contract/types';
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

export function col(nativeType: string, codecId: string, nullable = false): StorageColumn {
  return new StorageColumn({ nativeType, codecId, nullable });
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
  columns: readonly string[],
  refTable: string,
  refColumns: readonly string[],
  opts?: ForeignKeyOptions & {
    constraint?: boolean;
    index?: boolean;
    namespaceId?: string;
  },
): ForeignKey {
  const defaults = applyFkDefaults({ constraint: opts?.constraint, index: opts?.index });
  const targetNamespaceId: string =
    opts?.namespaceId !== undefined ? opts.namespaceId : UNBOUND_NAMESPACE_ID;
  return new ForeignKey({
    source: { columns },
    target: {
      namespaceId: targetNamespaceId,
      table: refTable,
      columns: refColumns,
    },
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
    namespaceId?: string;
  },
): StorageTable {
  const namespaceId: string =
    opts?.namespaceId !== undefined ? opts.namespaceId : UNBOUND_NAMESPACE_ID;
  return new StorageTable({
    namespaceId,
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
): {
  storage: SqlModelStorage;
  fields: Record<string, { readonly nullable: boolean; readonly type: ScalarFieldType }>;
  relations: Record<string, unknown>;
} {
  const storage: SqlModelStorage = { table: tableName, fields };
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
