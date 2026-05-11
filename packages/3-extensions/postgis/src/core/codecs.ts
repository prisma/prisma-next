/**
 * Geometry codec for the PostGIS extension.
 *
 * Mirrors the class-based pattern used by pgvector. Three artifacts:
 *
 * 1. `PostgisGeometryCodec` extends {@link CodecImpl} with the runtime encode/decode/encodeJson/decodeJson conversions. Wire formats: `encode` produces an EWKT string (`'SRID=4326;POINT(...)'`) that PostgreSQL parses when cast to `::geometry`; `decode` parses the hex EWKB string `node-postgres` returns for `geometry` columns into a GeoJSON-shaped object.
 * 2. `PostgisGeometryDescriptor` extends {@link CodecDescriptorImpl} with the codec id, traits, target types, params schema (`{ srid: number }`), `meta` (postgres `nativeType: 'geometry'`), and the emit-path `renderOutputType` producing `Geometry<srid>`.
 * 3. `geometry({ srid })` / `geometryColumn` live in `exports/column-types.ts` and feed `descriptor.factory({ srid })` through `column(...)` at the column-helper site.
 *
 * The geometry codec's encode/decode is parameter-independent — the wire format already carries SRID inside the EWKT/EWKB payload, so every `{ srid }` instance shares the same codec object.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
} from '@prisma-next/framework-components/codec';
import type { ExtractCodecTypes } from '@prisma-next/sql-relational-core/ast';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type as arktype } from 'arktype';
import { POSTGIS_GEOMETRY_CODEC_ID } from './constants';
import { decodeEWKBHex, encodeEWKT } from './ewkb';
import type { Geometry } from './geojson';

type GeometryParams = { readonly srid: number };

const geometryParamsSchema = arktype({
  srid: 'number',
}).narrow((params, ctx) => {
  const { srid } = params;
  if (!Number.isInteger(srid)) {
    return ctx.mustBe('an integer');
  }
  if (srid < 0) {
    return ctx.mustBe('a non-negative integer');
  }
  return true;
}) satisfies StandardSchemaV1<GeometryParams>;

const PG_GEOMETRY_META = { db: { sql: { postgres: { nativeType: 'geometry' } } } } as const;

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

export class PostgisGeometryCodec extends CodecImpl<
  typeof POSTGIS_GEOMETRY_CODEC_ID,
  readonly ['equality'],
  string,
  Geometry
> {
  async encode(value: Geometry, _ctx: CodecCallContext): Promise<string> {
    assertGeometry(value);
    return encodeEWKT(value);
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<Geometry> {
    if (typeof wire !== 'string') {
      throw new Error('Geometry wire value must be a string');
    }
    return decodeEWKBHex(wire);
  }

  encodeJson(value: Geometry): JsonValue {
    assertGeometry(value);
    return value as unknown as JsonValue;
  }

  decodeJson(json: JsonValue): Geometry {
    assertGeometry(json);
    return json;
  }
}

export class PostgisGeometryDescriptor extends CodecDescriptorImpl<GeometryParams> {
  override readonly codecId = POSTGIS_GEOMETRY_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['geometry'] as const;
  override readonly meta = PG_GEOMETRY_META;
  override readonly paramsSchema: StandardSchemaV1<GeometryParams> = geometryParamsSchema;

  override renderOutputType(params: GeometryParams): string {
    const srid = (params as GeometryParams | undefined)?.srid;
    if (srid === undefined) return 'Geometry';
    if (typeof srid !== 'number' || !Number.isInteger(srid) || srid < 0) {
      throw new Error(
        `renderOutputType: expected non-negative integer "srid" in typeParams for Geometry, got ${String(srid)}`,
      );
    }
    return `Geometry<${srid}>`;
  }

  private readonly sharedCodec: PostgisGeometryCodec = new PostgisGeometryCodec(this);

  override factory(_params: GeometryParams): (ctx: CodecInstanceContext) => PostgisGeometryCodec {
    return () => this.sharedCodec;
  }
}

export const postgisGeometryDescriptor = new PostgisGeometryDescriptor();

const codecDescriptorMap = {
  geometry: postgisGeometryDescriptor,
} as const;

export type CodecTypes = ExtractCodecTypes<typeof codecDescriptorMap>;

export const codecDescriptors: readonly AnyCodecDescriptor[] = Object.values(codecDescriptorMap);
