import type { Geometry } from '@prisma-next/extension-postgis/codec-types';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

/**
 * Cafes that fall inside a neighborhood polygon.
 *
 * SQL: WHERE ST_Within(location, $boundary)
 */
export function findCafesInNeighborhood(boundary: Geometry, runtime?: Runtime) {
  const plan = db.sql.cafe
    .select('id', 'name')
    .where((f, fns) => fns.within(f.location, boundary))
    .build();
  return (runtime ?? db.runtime()).execute(plan);
}
