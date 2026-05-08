import type { Geometry } from '@prisma-next/extension-postgis/codec-types';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

/**
 * Reverse geocoding by polygon: which neighborhoods contain this point?
 *
 * SQL: WHERE ST_Contains(boundary, $point)
 */
export function findNeighborhoodForPoint(point: Geometry, runtime?: Runtime) {
  const plan = db.sql.neighborhood
    .select('id', 'name')
    .where((f, fns) => fns.contains(f.boundary, point))
    .build();
  return (runtime ?? db.runtime()).execute(plan);
}
