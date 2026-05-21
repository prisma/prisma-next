import { describe, expect, it } from 'vitest';
import { pgVectorDescriptor } from '../src/core/codecs';

const instanceCtx = { name: '<test>' };

describe('renderSqlLiteral on pg/vector@1', () => {
  it('renders fixed-dimension vectors as bracketed-list literals with vector cast', () => {
    const codec = pgVectorDescriptor.factory({ length: 3 })(instanceCtx);
    expect(codec.renderSqlLiteral([1, 2, 3])).toBe("'[1,2,3]'::vector");
  });

  it('renders floating-point components verbatim', () => {
    const codec = pgVectorDescriptor.factory({ length: 2 })(instanceCtx);
    expect(codec.renderSqlLiteral([0.5, -1.25])).toBe("'[0.5,-1.25]'::vector");
  });

  it('rejects dimension mismatches before rendering', () => {
    const codec = pgVectorDescriptor.factory({ length: 3 })(instanceCtx);
    expect(() => codec.renderSqlLiteral([1, 2])).toThrow();
  });

  it('rejects non-array inputs', () => {
    const codec = pgVectorDescriptor.factory({ length: 3 })(instanceCtx);
    // @ts-expect-error type-level rejection mirrors the runtime assertion
    expect(() => codec.renderSqlLiteral('foo')).toThrow();
  });
});
