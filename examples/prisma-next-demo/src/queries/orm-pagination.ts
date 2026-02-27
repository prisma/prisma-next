import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { demoSchema, demoSql } from '../prisma/context';
import { collect } from './utils';

/**
 * ID-based cursor pagination (forward)
 * Uses the ID column as the cursor for stable, efficient pagination
 */
export async function ormGetUsersByIdCursor(
  cursor: string | null,
  pageSize: number,
  runtime: Runtime,
) {
  const userTable = demoSchema.tables.user;

  let builder = demoSql
    .from(userTable)
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
    })
    .orderBy(userTable.columns.id.asc())
    .limit(pageSize);

  if (cursor !== null) {
    builder = builder.where(userTable.columns.id.gt(param('cursor')));
  }

  const plan = builder.build({
    params: cursor !== null ? { cursor } : {},
  });

  return collect(runtime.execute(plan));
}

/**
 * Timestamp-based cursor pagination (forward, most recent first)
 * Uses createdAt timestamp for pagination, ordered by most recent first
 */
export async function ormGetUsersByTimestampCursor(
  cursor: Date | null,
  pageSize: number,
  runtime: Runtime,
) {
  const userTable = demoSchema.tables.user;

  let builder = demoSql
    .from(userTable)
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
    })
    .orderBy(userTable.columns.createdAt.desc())
    .limit(pageSize);

  if (cursor !== null) {
    builder = builder.where(userTable.columns.createdAt.lt(param('cursor')));
  }

  const plan = builder.build({
    params: cursor !== null ? { cursor: cursor.toISOString() } : {},
  });

  return collect(runtime.execute(plan));
}

/**
 * Backward pagination (previous page)
 * Fetches records before the cursor, useful for "previous page" navigation
 */
export async function ormGetUsersBackward(cursor: string, pageSize: number, runtime: Runtime) {
  const userTable = demoSchema.tables.user;

  const plan = demoSql
    .from(userTable)
    .where(userTable.columns.id.lt(param('cursor')))
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
      createdAt: userTable.columns.createdAt,
    })
    .orderBy(userTable.columns.id.desc())
    .limit(pageSize)
    .build({
      params: { cursor },
    });

  return collect(runtime.execute(plan));
}

/**
 * Pagination helper: Get first page
 * Convenience function for getting the initial page
 */
export async function ormGetUsersFirstPage(pageSize: number, runtime: Runtime) {
  return ormGetUsersByIdCursor(null, pageSize, runtime);
}

/**
 * Pagination helper: Get next page
 * Convenience function for getting the next page after a cursor
 */
export async function ormGetUsersNextPage(lastId: string, pageSize: number, runtime: Runtime) {
  return ormGetUsersByIdCursor(lastId, pageSize, runtime);
}
