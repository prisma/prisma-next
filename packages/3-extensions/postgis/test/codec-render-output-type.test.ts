import { describe, expect, it } from 'vitest';
import { postgisGeometryDescriptor } from '../src/core/codecs';

describe('postgis descriptor renderOutputType', () => {
  it('renders Geometry<srid> when srid is present', () => {
    expect(postgisGeometryDescriptor.renderOutputType!({ srid: 4326 })).toBe('Geometry<4326>');
  });

  it('renders Geometry when srid is absent', () => {
    expect(postgisGeometryDescriptor.renderOutputType!({} as { srid: number })).toBe('Geometry');
  });

  it('throws on non-integer srid', () => {
    expect(() => postgisGeometryDescriptor.renderOutputType!({ srid: 1.5 })).toThrow(
      /non-negative integer/,
    );
  });

  it('throws on negative srid', () => {
    expect(() => postgisGeometryDescriptor.renderOutputType!({ srid: -1 })).toThrow(
      /non-negative integer/,
    );
  });
});
