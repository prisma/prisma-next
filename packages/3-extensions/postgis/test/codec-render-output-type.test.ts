import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../src/core/codecs';

describe('postgis codec renderOutputType', () => {
  const codec = codecDefinitions['geometry'].codec;

  it('renders Geometry<srid> when srid is present', () => {
    expect(codec.renderOutputType!({ srid: 4326 })).toBe('Geometry<4326>');
  });

  it('renders Geometry when srid is absent', () => {
    expect(codec.renderOutputType!({})).toBe('Geometry');
  });

  it('throws on non-integer srid', () => {
    expect(() => codec.renderOutputType!({ srid: 1.5 })).toThrow(/non-negative integer/);
  });

  it('throws on negative srid', () => {
    expect(() => codec.renderOutputType!({ srid: -1 })).toThrow(/non-negative integer/);
  });
});
