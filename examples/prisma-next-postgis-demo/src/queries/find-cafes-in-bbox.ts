import { bboxPolygon } from '@prisma-next/extension-postgis/geojson';
import type { Runtime } from '@prisma-next/sql-runtime';
import { db } from '../prisma/db';

/**
 * Cafes whose `location` falls inside a lat/lng bounding box.
 *
 * Uses the `&&` operator (`intersectsBbox`) which compares 2-D bounding
 * boxes only — fast, index-friendly, and exactly what map UIs want for
 * their viewport queries.
 *
 * @param bbox - `[minLng, minLat, maxLng, maxLat]`.
 */
export function findCafesInBbox(
  bbox: readonly [number, number, number, number],
  runtime?: Runtime,
) {
  const envelope = bboxPolygon(bbox, 4326);
  const plan = db.sql.cafe
    .select('id', 'name')
    .where((f, fns) => fns.intersectsBbox(f.location, envelope))
    .build();
  return (runtime ?? db.runtime()).execute(plan);
}
