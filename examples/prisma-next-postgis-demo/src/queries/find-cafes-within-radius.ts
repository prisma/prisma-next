import type { Geometry } from '@prisma-next/extension-postgis/codec-types';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

/**
 * Cafes whose spherical distance to `point` is at most `metres`.
 *
 * `ST_DistanceSphere` works on `geometry` (not just `geography`) and
 * returns metres on a sphere — the right tool for "within N metres of"
 * queries on lat/lng data without converting columns to geography.
 *
 * SQL: WHERE ST_DistanceSphere(location, $point) <= $metres
 */
export function findCafesWithinRadius(
  point: Geometry,
  metres: number,
  limit = 50,
  runtime?: Runtime,
) {
  const plan = db.sql.cafe
    .select('id', 'name')
    .where((f, fns) => fns.lte(fns.distanceSphere(f.location, point), metres))
    .limit(limit)
    .build();
  return (runtime ?? db.runtime()).execute(plan);
}
