import type { JsonValue } from '@prisma-next/contract/types';
import type { CodecRef } from '@prisma-next/framework-components/codec';
import {
  isPostgresEnumStorageEntry,
  isStorageTypeInstance,
  type SqlStorage,
} from '@prisma-next/sql-contract/types';

/**
 * Derive the canonical {@link CodecRef} for a `(table, column)` pair against a {@link SqlStorage}. This is the build-time path every column-bound `ParamRef` / `ProjectionItem` uses to stamp its `codec` slot before the AST is handed to the runtime — the runtime resolver then materialises a memoised {@link import('@prisma-next/sql-relational-core/ast').Codec} for the same `CodecRef` via `forCodecRef`.
 *
 * Resolution rules over `storage.tables[table].columns[column]`:
 *
 * - `typeRef` column → `{codecId, typeParams}` from `storage.types[typeRef]` (multiple columns sharing the typeRef share one ref → one memoised codec).
 * - inline `typeParams` column → `{codecId, typeParams}` from the column itself.
 * - non-parameterized column → `{codecId}` with `typeParams` undefined.
 *
 * Returns `undefined` when the table or column is unknown, or when a `typeRef` column references a `storage.types` entry that does not exist.
 */
export function codecRefForStorageColumn(
  storage: SqlStorage,
  tableName: string,
  columnName: string,
): CodecRef | undefined {
  const tableDef = storage.tables[tableName];
  if (!tableDef) return undefined;
  const columnDef = tableDef.columns[columnName];
  if (!columnDef) return undefined;
  if (columnDef.typeRef !== undefined) {
    const instance = storage.types?.[columnDef.typeRef];
    if (!instance) return undefined;
    if (isPostgresEnumStorageEntry(instance)) {
      // Both the live IR-class instance (with `codecBinding` accessor)
      // and the raw JSON envelope (with enumerable `codecId` +
      // `values` own properties) satisfy the structural shape; reading
      // them directly off the structural fields keeps this dispatch
      // path layered against the framework-shared alphabet rather than
      // a target-specific class import.
      return {
        codecId: instance.codecId,
        typeParams: { values: instance.values } as unknown as JsonValue,
      };
    }
    if (isStorageTypeInstance(instance)) {
      return { codecId: instance.codecId, typeParams: instance.typeParams as JsonValue };
    }
    return undefined;
  }
  if (columnDef.typeParams !== undefined) {
    return { codecId: columnDef.codecId, typeParams: columnDef.typeParams as JsonValue };
  }
  return { codecId: columnDef.codecId };
}
