/**
 * Codec ID for the PostGIS `geometry` type.
 */
export const POSTGIS_GEOMETRY_CODEC_ID = 'pg/geometry@1' as const;

/**
 * SRID 4326 (WGS84) is the most common spatial reference system —
 * the one used by GPS, Google Maps, and GeoJSON.
 */
export const SRID_WGS84 = 4326 as const;
