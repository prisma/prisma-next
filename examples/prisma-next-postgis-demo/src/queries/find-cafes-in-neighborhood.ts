import type { Geometry } from '@prisma-next/extension-postgis/codec-types';
import { db } from '../prisma/db';

/**
 * Cafes that fall inside a neighborhood polygon.
 *
 * SQL: WHERE ST_Within(location, $boundary)
 */
export function findCafesInNeighborhood(boundary: Geometry) {
  return db.orm.public.Cafe.where((c) => c.location.within(boundary)).all();
}
