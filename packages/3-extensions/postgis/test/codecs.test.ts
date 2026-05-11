import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { postgisGeometryDescriptor } from '../src/core/codecs';
import type { Geometry } from '../src/core/geojson';

const geometryCodec = postgisGeometryDescriptor.factory({ srid: 0 })({ name: '<test>' });
const callCtx = {} as Parameters<typeof geometryCodec.encode>[1];

describe('postgis codecs', () => {
  it(
    'has geometry descriptor registered',
    () => {
      expect(postgisGeometryDescriptor.codecId).toBe('pg/geometry@1');
      expect(postgisGeometryDescriptor.targetTypes).toEqual(['geometry']);
    },
    timeouts.default,
  );

  describe('paramsSchema', () => {
    const schema = postgisGeometryDescriptor.paramsSchema;

    it('accepts a non-negative integer srid', () => {
      const out = schema['~standard'].validate({ srid: 4326 });
      expect(out).toMatchObject({ value: { srid: 4326 } });
    });

    it('rejects a non-integer srid', () => {
      const out = schema['~standard'].validate({ srid: 1.5 });
      expect(out).toHaveProperty('issues');
    });

    it('rejects a negative srid', () => {
      const out = schema['~standard'].validate({ srid: -1 });
      expect(out).toHaveProperty('issues');
    });
  });

  describe('encode (Geometry → EWKT)', () => {
    it('encodes a Point without SRID', async () => {
      expect(await geometryCodec.encode({ type: 'Point', coordinates: [1, 2] }, callCtx)).toBe(
        'POINT(1 2)',
      );
    });

    it('encodes a Point with SRID prefix', async () => {
      expect(
        await geometryCodec.encode(
          { type: 'Point', coordinates: [-122.4194, 37.7749], srid: 4326 },
          callCtx,
        ),
      ).toBe('SRID=4326;POINT(-122.4194 37.7749)');
    });

    it('encodes a LineString', async () => {
      expect(
        await geometryCodec.encode(
          {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [1, 1],
              [2, 0],
            ],
            srid: 4326,
          },
          callCtx,
        ),
      ).toBe('SRID=4326;LINESTRING(0 0,1 1,2 0)');
    });

    it('encodes a Polygon with one ring', async () => {
      expect(
        await geometryCodec.encode(
          {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
            srid: 4326,
          },
          callCtx,
        ),
      ).toBe('SRID=4326;POLYGON((0 0,1 0,1 1,0 1,0 0))');
    });

    it('encodes a MultiPoint', async () => {
      expect(
        await geometryCodec.encode(
          {
            type: 'MultiPoint',
            coordinates: [
              [1, 2],
              [3, 4],
            ],
          },
          callCtx,
        ),
      ).toBe('MULTIPOINT(1 2,3 4)');
    });

    it('rejects non-object input', async () => {
      await expect(geometryCodec.encode(null as unknown as Geometry, callCtx)).rejects.toThrow(
        'Geometry value must be a GeoJSON-shaped object',
      );
    });

    it('rejects an unsupported geometry type', async () => {
      await expect(
        geometryCodec.encode(
          { type: 'Sphere', coordinates: [0, 0, 0] } as unknown as Geometry,
          callCtx,
        ),
      ).rejects.toThrow(/unsupported type/);
    });

    it('rejects when coordinates is not an array', async () => {
      await expect(
        geometryCodec.encode(
          { type: 'Point', coordinates: 'oops' } as unknown as Geometry,
          callCtx,
        ),
      ).rejects.toThrow('Geometry value: "coordinates" must be an array');
    });

    it('rejects non-finite coordinate values', async () => {
      await expect(
        geometryCodec.encode({ type: 'Point', coordinates: [Number.NaN, 0] } as Geometry, callCtx),
      ).rejects.toThrow('coordinates must be finite numbers');
    });
  });

  describe('encodeJson / decodeJson', () => {
    it('round-trips a Geometry through encodeJson + decodeJson', () => {
      const value: Geometry = { type: 'Point', coordinates: [1, 2], srid: 4326 };
      const json = geometryCodec.encodeJson(value);
      expect(json).toEqual(value);
      expect(geometryCodec.decodeJson(json)).toEqual(value);
    });

    it('encodeJson rejects non-object input', () => {
      expect(() => geometryCodec.encodeJson(null as unknown as Geometry)).toThrow(
        'Geometry value must be a GeoJSON-shaped object',
      );
    });

    it('decodeJson rejects an unsupported type', () => {
      expect(() =>
        geometryCodec.decodeJson({ type: 'Sphere', coordinates: [] } as unknown as Geometry),
      ).toThrow(/unsupported type/);
    });
  });

  describe('decode (EWKB hex → Geometry)', () => {
    it('decodes a Point without SRID (LE)', async () => {
      // LE byte order, type=Point (1), x=1.0, y=2.0
      const hex = '0101000000000000000000F03F0000000000000040';
      expect(await geometryCodec.decode(hex, callCtx)).toEqual({
        type: 'Point',
        coordinates: [1, 2],
      });
    });

    it('decodes a Point with SRID 4326 (LE)', async () => {
      // LE byte order, type=Point|SRID flag (0x20000001), srid=4326, x=1.0, y=2.0
      const hex = '0101000020E6100000000000000000F03F0000000000000040';
      expect(await geometryCodec.decode(hex, callCtx)).toEqual({
        type: 'Point',
        coordinates: [1, 2],
        srid: 4326,
      });
    });

    it('rejects non-string wire input', async () => {
      await expect(geometryCodec.decode(123 as unknown as string, callCtx)).rejects.toThrow(
        'Geometry wire value must be a string',
      );
    });

    it('rejects an odd-length hex string', async () => {
      await expect(geometryCodec.decode('0', callCtx)).rejects.toThrow('odd-length hex string');
    });

    it('rejects malformed hex bytes', async () => {
      await expect(geometryCodec.decode('ZZ', callCtx)).rejects.toThrow('invalid hex byte');
    });
  });
});
