import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';

/**
 * Default storage namespace for Postgres-family contracts at runtime.
 * Mirrors authoring's `POSTGRES_DEFAULT_NAMESPACE_ID` in contract-ts.
 */
export const POSTGRES_DEFAULT_STORAGE_NAMESPACE_ID = 'public' as const;

/**
 * Per-target default storage namespace id for SQL-family contracts.
 * Postgres uses the `public` schema; other SQL targets use the late-bound
 * unbound sentinel (SQLite singleton namespace).
 */
export function defaultStorageNamespaceIdForSqlTarget(targetId: string): string {
  return targetId === 'postgres' ? POSTGRES_DEFAULT_STORAGE_NAMESPACE_ID : UNBOUND_NAMESPACE_ID;
}
