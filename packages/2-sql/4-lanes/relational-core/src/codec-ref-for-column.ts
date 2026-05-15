import type { JsonValue } from '@prisma-next/contract/types';
import type { CodecRef } from '@prisma-next/framework-components/codec';
import {
  isStorageTypeInstance,
  SqlEnumType,
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
    if (instance instanceof SqlEnumType) {
      return {
        codecId: instance.codecBinding.codecId,
        typeParams: instance.codecBinding.typeParams as unknown as JsonValue,
      };
    }
    // Raw JSON enum envelope (`kind: 'postgres-enum'`): hydration
    // didn't run (e.g. user-written `migration.ts` passing
    // `end-contract.json` directly to `createExecutionContext`). The
    // envelope carries `codecId` + `values` as enumerable own
    // properties on the per-target subclass, so we synthesise the
    // codec-typed `typeParams.values` shape from there.
    if ((instance as { kind?: string }).kind === 'postgres-enum') {
      const enumLike = instance as unknown as {
        readonly codecId?: string;
        readonly values?: readonly string[];
      };
      if (enumLike.codecId !== undefined) {
        return {
          codecId: enumLike.codecId,
          typeParams: { values: enumLike.values ?? [] } as unknown as JsonValue,
        };
      }
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
