import type { Geometry } from '@prisma-next/extension-postgis/codec-types';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

/**
 * Order all cafes by spherical distance to a query point and return the
 * closest `limit` rows.
 *
 * SQL shape (one statement):
 *   SELECT id, name, ST_DistanceSphere(location, $point) AS meters
 *   FROM cafe
 *   ORDER BY ST_DistanceSphere(location, $point) ASC
 *   LIMIT $limit
 */
export function findCafesNearPoint(point: Geometry, limit = 10, runtime?: Runtime) {
  const plan = db.sql.cafe
    .select('id', 'name')
    .select('meters', (f, fns) => fns.distanceSphere(f.location, point))
    .orderBy((f, fns) => fns.distanceSphere(f.location, point), { direction: 'asc' })
    .limit(limit)
    .build();
  return (runtime ?? db.runtime()).execute(plan);
}
