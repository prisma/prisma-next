import { param } from '@prisma-next/sql-relational-core/param';
import type { Runtime } from '@prisma-next/sql-runtime';
import { orm } from '../prisma/query.ts';
import { collect } from './utils.ts';

/**
 * ID-based cursor pagination (forward)
 * Uses the ID column as the cursor for stable, efficient pagination
 */
export async function ormGetUsersByIdCursor(
  cursor: number | null,
  pageSize: number,
  runtime: Runtime,
) {
  let builder = orm
    .user()
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
    }))
    .orderBy((u) => u.id.asc())
    .take(pageSize);

  if (cursor !== null) {
    builder = builder.where((u) => u.id.gt(param('cursor')));
  }

  const plan = builder.findMany({
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
  let builder = orm
    .user()
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
    }))
    .orderBy((u) => u.createdAt.desc())
    .take(pageSize);

  if (cursor !== null) {
    builder = builder.where((u) => u.createdAt.lt(param('cursor')));
  }

  const plan = builder.findMany({
    params: cursor !== null ? { cursor } : {},
  });

  return collect(runtime.execute(plan));
}

/**
 * Backward pagination (previous page)
 * Fetches records before the cursor, useful for "previous page" navigation
 */
export async function ormGetUsersBackward(cursor: number, pageSize: number, runtime: Runtime) {
  const plan = orm
    .user()
    .where((u) => u.id.lt(param('cursor')))
    .select((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
    }))
    .orderBy((u) => u.id.desc())
    .take(pageSize)
    .findMany({
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
export async function ormGetUsersNextPage(lastId: number, pageSize: number, runtime: Runtime) {
  return ormGetUsersByIdCursor(lastId, pageSize, runtime);
}
