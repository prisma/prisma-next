/**
 * Column type descriptors for the PostGIS extension.
 *
 * Use `geometryColumn` for an untyped `geometry` column, or
 * `geometry({ srid })` to declare an SRID-constrained column whose DDL
 * comes out as `geometry(Geometry, <srid>)`.
 */

import type { ColumnTypeDescriptor } from '@prisma-next/framework-components/codec';
import { POSTGIS_GEOMETRY_CODEC_ID } from '../core/constants';

export const geometryColumn = {
  codecId: POSTGIS_GEOMETRY_CODEC_ID,
  nativeType: 'geometry',
} as const satisfies ColumnTypeDescriptor;

/**
 * Build an SRID-constrained geometry column descriptor.
 *
 * @example
 *   .column('location', { type: geometry({ srid: 4326 }), nullable: false })
 *   // Produces: nativeType: 'geometry', typeParams: { srid: 4326 }
 *
 * @throws {RangeError} If `srid` is not a non-negative integer.
 */
export function geometry<S extends number>(options: {
  readonly srid: S;
}): ColumnTypeDescriptor & { readonly typeParams: { readonly srid: S } } {
  const { srid } = options;
  if (!Number.isInteger(srid) || srid < 0) {
    throw new RangeError(`postgis: srid must be a non-negative integer, got ${srid}`);
  }
  return {
    codecId: POSTGIS_GEOMETRY_CODEC_ID,
    nativeType: 'geometry',
    typeParams: { srid },
  } as const;
}
