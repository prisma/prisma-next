/**
 * Geometry codec implementation for the PostGIS extension.
 *
 * Wire formats:
 *   - encode: EWKT string (`'SRID=4326;POINT(...)'`) — PostgreSQL parses
 *     this when cast to `::geometry`.
 *   - decode: hex EWKB string — the default representation `node-postgres`
 *     hands back for `geometry` columns. We parse it into a GeoJSON-shaped
 *     object so callers see structured data, not opaque hex.
 */

import { codec, defineCodecs } from '@prisma-next/sql-relational-core/ast';
import { decodeEWKBHex, encodeEWKT } from './ewkb';
import type { Geometry } from './geojson';

const allowedGeometryTypes = new Set([
  'Point',
  'LineString',
  'Polygon',
  'MultiPoint',
  'MultiLineString',
  'MultiPolygon',
]);

function assertGeometry(value: unknown): asserts value is Geometry {
  if (!value || typeof value !== 'object') {
    throw new Error('Geometry value must be a GeoJSON-shaped object');
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !allowedGeometryTypes.has(type)) {
    throw new Error(
      `Geometry value: unsupported type "${String(type)}" (expected Point, LineString, Polygon, MultiPoint, MultiLineString, or MultiPolygon)`,
    );
  }
  if (!Array.isArray((value as { coordinates?: unknown }).coordinates)) {
    throw new Error('Geometry value: "coordinates" must be an array');
  }
}

const pgGeometryCodec = codec({
  typeId: 'pg/geometry@1',
  targetTypes: ['geometry'],
  traits: ['equality'],
  renderOutputType: (typeParams) => {
    const srid = typeParams['srid'];
    if (srid === undefined) return 'Geometry';
    if (typeof srid !== 'number' || !Number.isInteger(srid) || srid < 0) {
      throw new Error(
        `renderOutputType: expected non-negative integer "srid" in typeParams for Geometry, got ${String(srid)}`,
      );
    }
    return `Geometry<${srid}>`;
  },
  encode: (value: Geometry): string => {
    assertGeometry(value);
    return encodeEWKT(value);
  },
  decode: (wire: string): Geometry => {
    if (typeof wire !== 'string') {
      throw new Error('Geometry wire value must be a string');
    }
    return decodeEWKBHex(wire);
  },
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'geometry',
        },
      },
    },
  },
});

const codecs = defineCodecs().add('geometry', pgGeometryCodec);

export const codecDefinitions = codecs.codecDefinitions;
export const dataTypes = codecs.dataTypes;

export type CodecTypes = typeof codecs.CodecTypes;
