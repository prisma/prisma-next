import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../src/core/codecs';

describe('pgvector codec renderOutputType', () => {
  const codec = codecDefinitions['vector'].codec;

  it('renders Vector<length> when length is present', () => {
    expect(codec.renderOutputType!({ length: 1536 })).toBe('Vector<1536>');
  });

  it('renders Vector<length> with small dimension', () => {
    expect(codec.renderOutputType!({ length: 3 })).toBe('Vector<3>');
  });

  it('returns undefined when length is absent', () => {
    expect(codec.renderOutputType!({})).toBeUndefined();
  });

  it('throws on NaN length', () => {
    expect(() => codec.renderOutputType!({ length: Number.NaN })).toThrow(
      /expected positive integer "length"/,
    );
  });
});
