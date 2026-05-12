import type { Geometry } from '@prisma-next/extension-postgis/codec-types';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

/**
 * Routes whose path intersects another geometry — typically a polygon
 * (e.g., a closure zone) or another route's LineString.
 *
 * SQL: WHERE ST_Intersects(path, $other)
 */
export function findRoutesIntersecting(other: Geometry, runtime: Runtime) {
  const plan = db.sql.route
    .select('id', 'name')
    .where((f, fns) => fns.intersects(f.path, other))
    .build();
  return runtime.execute(plan);
}
