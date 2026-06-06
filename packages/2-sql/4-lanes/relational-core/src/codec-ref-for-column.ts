import type { JsonValue } from '@prisma-next/contract/types';
import type { CodecRef } from '@prisma-next/framework-components/codec';
import {
  isPostgresEnumStorageEntry,
  isStorageTypeInstance,
  type SqlStorage,
  type StorageTable,
} from '@prisma-next/sql-contract/types';

/**
 * Derive the canonical {@link CodecRef} for a `(table, column)` pair against a {@link SqlStorage}. This is the build-time path every column-bound `ParamRef` / `ProjectionItem` uses to stamp its `codec` slot before the AST is handed to the runtime — the runtime resolver then materialises a memoised {@link import('@prisma-next/sql-relational-core/ast').Codec} for the same `CodecRef` via `forCodecRef`.
 *
 * Resolution rules over namespace `entries.table[table].columns[column]`:
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
  let tableDef: StorageTable | undefined;
  for (const ns of Object.values(storage.namespaces)) {
    const candidate = ns.entries.table[tableName] as StorageTable | undefined;
    if (candidate !== undefined) {
      tableDef = candidate;
      break;
    }
  }
  if (!tableDef) return undefined;
  const columnDef = tableDef.columns[columnName];
  if (!columnDef) return undefined;
  if (columnDef.typeRef !== undefined) {
    let instance: unknown = storage.types?.[columnDef.typeRef];
    if (!instance) {
      for (const ns of Object.values(storage.namespaces)) {
        const typeSlot = (ns.entries as { type?: Record<string, unknown> }).type;
        const nsEntry = typeSlot?.[columnDef.typeRef];
        if (nsEntry !== undefined) {
          instance = nsEntry;
          break;
        }
      }
    }
    if (!instance) return undefined;
    if (isPostgresEnumStorageEntry(instance)) {
      // Canonical path: the entry is a live `PostgresEnumType` IR
      // instance reached through the per-target serializer's
      // hydration. Raw JSON envelopes carrying `kind: 'postgres-enum'`
      // never reach this site — `SqlStorage.normaliseTypeEntry`
      // rejects them upstream (F09). Read `codecId` and `values` off
      // the structural shape (enumerable own properties on the live
      // instance) so the dispatch stays layered against the family
      // alphabet rather than a target-specific class import.
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
