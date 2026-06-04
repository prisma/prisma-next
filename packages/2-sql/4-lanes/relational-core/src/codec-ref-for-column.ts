import type { JsonValue } from '@prisma-next/contract/types';
import type { CodecRef } from '@prisma-next/framework-components/codec';
import { resolveStorageTable } from '@prisma-next/sql-contract/resolve-storage-table';
import {
  isPostgresEnumStorageEntry,
  isStorageTypeInstance,
  type SqlStorage,
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
 *
 * `namespaceId` leads the coordinate args and is always supplied: every
 * model/table sits in an explicit namespace, so the table is resolved strictly
 * within that namespace (see {@link resolveStorageTable}).
 */
export function codecRefForStorageColumn(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
  columnName: string,
): CodecRef | undefined {
  const resolved = resolveStorageTable(storage, tableName, namespaceId);
  if (resolved === undefined) return undefined;
  const tableDef = resolved.table;
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
      // Empty-state canonicalization: a `StorageTypeInstance` with absent
      // (or empty) `typeParams` produces a `CodecRef` with no `typeParams`
      // field. Equivalent to the non-parameterized-column branch below.
      // Carrying `{}` here would break content-keyed memoisation and trip
      // the runtime validator against non-parameterized codec descriptors.
      const instanceParams = instance.typeParams;
      const hasParamKeys = instanceParams !== undefined && Object.keys(instanceParams).length > 0;
      return hasParamKeys
        ? { codecId: instance.codecId, typeParams: instanceParams as JsonValue }
        : { codecId: instance.codecId };
    }
    return undefined;
  }
  if (columnDef.typeParams !== undefined && Object.keys(columnDef.typeParams).length > 0) {
    return { codecId: columnDef.codecId, typeParams: columnDef.typeParams as JsonValue };
  }
  return { codecId: columnDef.codecId };
}
